import { readonly, ref } from 'vue'
import { useVad } from './useVad'
import { useDeskpetStore } from '@/stores/deskpet'

function getSttUrl(): string {
  try { return localStorage.getItem('deskpet/stt-url') || 'http://127.0.0.1:18530/stt' } catch { return 'http://127.0.0.1:18530/stt' }
}

function getVadThreshold(): number {
  const v = parseFloat(localStorage.getItem('deskpet/vad-threshold') || '0.02')
  return Number.isFinite(v) && v > 0 ? v : 0.02
}

function getVadSilence(): number {
  const v = parseFloat(localStorage.getItem('deskpet/vad-silence') || '1.5')
  return Number.isFinite(v) && v > 0 ? v : 1.5
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const TARGET_SR = 16000
  let resampled = samples
  if (sampleRate !== TARGET_SR) {
    const ratio = sampleRate / TARGET_SR
    const len = Math.floor(samples.length / ratio)
    resampled = new Float32Array(len)
    for (let i = 0; i < len; i++) resampled[i] = samples[Math.floor(i * ratio)]
  }
  const numChannels = 1; const bitsPerSample = 16; const bytesPerSample = bitsPerSample / 8
  const dataLength = resampled.length * bytesPerSample
  const buf = new ArrayBuffer(44 + dataLength); const v = new DataView(buf)
  const w = (p: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + dataLength, true); w(8, 'WAVE')
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, numChannels, true); v.setUint32(24, TARGET_SR, true)
  v.setUint32(28, TARGET_SR * numChannels * bytesPerSample, true)
  v.setUint16(32, numChannels * bytesPerSample, true); v.setUint16(34, bitsPerSample, true)
  w(36, 'data'); v.setUint32(40, dataLength, true)
  for (let i = 0; i < resampled.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, resampled[i])) * 0x7FFF, true)
  return buf
}

const MAX_RECORD_DURATION_MS = 60_000

export function useVoiceInput(options?: { onError?: (msg: string) => void }) {
  const store = useDeskpetStore()
  const vad = useVad()
  const recordingActive = ref(false)
  const vadActive = ref(false)
  const manualOwner = {}
  const vadOwner = {}
  let micStream: MediaStream | null = null
  let micPromise: Promise<MediaStream> | null = null
  let onTranscribed: ((text: string) => void) | null = null
  let pendingVadRequests = 0
  let vadGeneration = 0
  let disposed = false

  interface RecordCycle {
    owner: object
    cancelled: boolean
    recorder: MediaRecorder | null
    maxTimer: ReturnType<typeof setTimeout> | null
    done: Promise<string | null>
    settle: (text: string | null) => void
  }
  // currentCycle 包含正在申请/录制/停止的轮次；转写轮次仍留在 cycles 内以便按所有者取消。
  let currentCycle: RecordCycle | null = null
  const cycles = new Set<RecordCycle>()

  async function acquireMic(): Promise<MediaStream> {
    if (micStream && micStream.getTracks().some((t) => t.readyState === 'live')) return micStream
    if (!micPromise) {
      micPromise = navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          micStream = stream
          stream.getTracks().forEach((track) => {
            if (typeof track.addEventListener === 'function') {
              track.addEventListener('ended', () => {
                if (micStream === stream) {
                  micStream = null
                  if (vadActive.value) disableVad()
                  cancelRecording()
                  options?.onError?.('（麦克风已断开）')
                }
              })
            }
          })
          return stream
        })
        .finally(() => { micPromise = null })
    }
    return micPromise
  }

  function releaseMicIfIdle() {
    // 等待授权的 VAD 也是消费者，不能被已取消的 PTT 提前关闭共享流。
    if (vadActive.value || pendingVadRequests > 0 || currentCycle) return
    micStream?.getTracks().forEach((t) => t.stop())
    micStream = null
  }

  async function transcribe(blob: Blob): Promise<string | null> {
    const raw = await blob.arrayBuffer()
    const ctx = new AudioContext()
    try {
      const audio = await ctx.decodeAudioData(raw)
      const wav = encodeWav(audio.getChannelData(0), audio.sampleRate)
      return (await window.electronAPI?.sttTranscribe(wav, getSttUrl())) ?? null
    } finally {
      void ctx.close()
    }
  }

  function detachCapture(cycle: RecordCycle): void {
    if (cycle.maxTimer !== null) {
      if (typeof clearTimeout === 'function') clearTimeout(cycle.maxTimer)
      cycle.maxTimer = null
    }
    if (currentCycle === cycle) {
      currentCycle = null
      recordingActive.value = false
    }
    releaseMicIfIdle()
  }

  async function startRecording(owner: object = manualOwner): Promise<boolean> {
    if (disposed || currentCycle) return false
    let settle!: (text: string | null) => void
    const done = new Promise<string | null>((resolve) => { settle = resolve })
    const cycle: RecordCycle = { owner, cancelled: false, recorder: null, maxTimer: null, done, settle }
    currentCycle = cycle // await 前先声明该轮次的所有权。
    cycles.add(cycle)
    const deliver = owner === vadOwner ? onTranscribed : null
    const vadToken = vadGeneration
    try {
      const stream = await acquireMic()
      if (cycle.cancelled || disposed) {
        cycles.delete(cycle)
        detachCapture(cycle)
        cycle.settle(null)
        return false
      }
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      cycle.recorder = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = async () => {
        detachCapture(cycle)
        let text: string | null = null
        try {
          if (!cycle.cancelled && chunks.length > 0) {
            text = await transcribe(new Blob(chunks, { type: 'audio/webm' }))
            if (cycle.cancelled || disposed || (owner === vadOwner && vadToken !== vadGeneration)) text = null
            if (text && deliver) deliver(text)
          }
        } catch (err) {
          console.warn('[Deskpet] Transcription failed:', err)
          if (!cycle.cancelled && !disposed) {
            options?.onError?.('（语音识别失败，请检查 STT 服务是否运行）')
          }
        } finally {
          cycles.delete(cycle)
          cycle.settle(text)
          releaseMicIfIdle()
        }
      }
      recorder.start()
      if (typeof setTimeout === 'function') {
        cycle.maxTimer = setTimeout(() => {
          if (currentCycle === cycle && recorder.state === 'recording') {
            void stopRecording(owner)
          }
        }, MAX_RECORD_DURATION_MS)
      }
      recordingActive.value = true
      return true
    } catch (err) {
      cycles.delete(cycle)
      detachCapture(cycle)
      cycle.settle(null)
      throw err
    }
  }

  function cancelCycle(cycle: RecordCycle): void {
    cycle.cancelled = true
    if (cycle.recorder?.state === 'recording') cycle.recorder.stop()
  }

  function cancelRecording(owner?: object): void {
    for (const cycle of cycles) {
      if (owner === undefined || cycle.owner === owner) cancelCycle(cycle)
    }
    releaseMicIfIdle()
  }

  function stopRecording(owner?: object): Promise<string | null> {
    const cycle = currentCycle
    if (!cycle || (owner !== undefined && cycle.owner !== owner)) return Promise.resolve(null)
    if (!cycle.recorder) cancelCycle(cycle)
    else if (cycle.recorder.state === 'recording') cycle.recorder.stop()
    return cycle.done
  }

  /** 独立输入通道只能停止/取消自己创建的轮次，不会碰替换它的手动或 VAD 录音。 */
  function createRecordingChannel() {
    const owner = {}
    return {
      start: () => startRecording(owner),
      stop: () => stopRecording(owner),
      cancel: () => cancelRecording(owner),
      hasCapture: () => currentCycle?.owner === owner && !currentCycle.cancelled,
    }
  }

  async function enableVad(callback: (text: string) => void) {
    if (disposed || vadActive.value || pendingVadRequests > 0) return
    const generation = ++vadGeneration
    pendingVadRequests++ // 在共享 getUserMedia await 前登记消费者租约。
    onTranscribed = callback
    try {
      vad.setThreshold(getVadThreshold())
      vad.setSilenceTimeout(getVadSilence())
      const stream = await acquireMic()
      if (disposed || generation !== vadGeneration) return
      vadActive.value = true
      await vad.start({
        onSpeechStart: () => {
          void startRecording(vadOwner).catch((err) => console.warn('[Deskpet] Failed to start recording:', err))
        },
        onSpeechEnd: () => { void stopRecording(vadOwner) },
        shouldListen: () => !store.isSpeaking,
        onSuppress: () => cancelRecording(vadOwner),
      }, stream)
      if (disposed || generation !== vadGeneration) {
        vadActive.value = false
        vad.stop()
      }
    } catch (err) {
      vadActive.value = false
      onTranscribed = null
      vad.stop()
      console.warn('[Deskpet] Failed to start VAD:', err)
      throw err
    } finally {
      pendingVadRequests--
      releaseMicIfIdle()
    }
  }

  function disableVad() {
    vadGeneration++
    vadActive.value = false
    onTranscribed = null
    vad.stop()
    cancelRecording(vadOwner)
    releaseMicIfIdle()
  }

  function cleanup() {
    disposed = true
    disableVad()
    cancelRecording()
    releaseMicIfIdle()
  }

  return {
    start: () => startRecording(),
    stop: () => stopRecording(),
    cancel: () => cancelRecording(),
    createRecordingChannel,
    recordingActive: readonly(recordingActive),
    vadActive: readonly(vadActive),
    enableVad,
    disableVad,
    cleanup,
  }
}

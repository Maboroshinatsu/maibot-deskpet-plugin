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

export function useVoiceInput() {
  const store = useDeskpetStore()
  const vad = useVad()

  /** VAD 与录音共用同一路麦克风流，避免开两路 getUserMedia */
  let micStream: MediaStream | null = null
  let micPromise: Promise<MediaStream> | null = null
  const recordingActive = ref(false)
  const vadActive = ref(false)
  let onTranscribed: ((text: string) => void) | null = null

  /** 当前录音轮次；每轮自持 recorder/chunks/promise，慢转写不会与下一轮串扰 */
  interface RecordCycle {
    recorder: MediaRecorder
    stop: () => Promise<string | null>
    cancel: () => void
  }
  let currentCycle: RecordCycle | null = null

  async function acquireMic(): Promise<MediaStream> {
    if (micStream && micStream.getTracks().some((t) => t.readyState === 'live')) return micStream
    // 并发 getUserMedia（左键 VAD + 右键手动同时按）会各开一路，先到的那路永远不被释放
    if (!micPromise) {
      micPromise = navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          micStream = stream
          return stream
        })
        .finally(() => { micPromise = null })
    }
    return micPromise
  }

  function releaseMicIfIdle() {
    if (vadActive.value || recordingActive.value) return
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
      ctx.close()
    }
  }

  async function startRecording(): Promise<void> {
    if (recordingActive.value) return
    const stream = await acquireMic()
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    const chunks: Blob[] = []
    let cancelled = false
    let settle: (text: string | null) => void
    const done = new Promise<string | null>((resolve) => { settle = resolve })

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = async () => {
      recordingActive.value = false
      if (currentCycle?.recorder === recorder) currentCycle = null
      let text: string | null = null
      if (!cancelled && chunks.length > 0) {
        try {
          text = await transcribe(new Blob(chunks, { type: 'audio/webm' }))
          if (text && onTranscribed) onTranscribed(text)
        } catch (err) {
          console.warn('[Deskpet] Transcription failed:', err)
        }
      }
      settle(text)
      releaseMicIfIdle()
    }

    currentCycle = {
      recorder,
      stop: () => {
        if (recorder.state === 'recording') recorder.stop()
        return done
      },
      cancel: () => {
        cancelled = true
        if (recorder.state === 'recording') recorder.stop()
      },
    }
    recorder.start()
    recordingActive.value = true
  }

  function stopRecording(): Promise<string | null> {
    if (!currentCycle) {
      recordingActive.value = false
      releaseMicIfIdle()
      return Promise.resolve(null)
    }
    return currentCycle.stop()
  }

  /** 丢弃当前录音（不转写）：TTS 插话时录音里已混入桌宠自己的声音 */
  function cancelRecording(): void {
    currentCycle?.cancel()
  }

  // 手动录音：按一次开始，再按一次结束，转写结果由 stop() 的 Promise 返回
  async function start(): Promise<void> { await startRecording() }
  function stop(): Promise<string | null> { return stopRecording() }

  // VAD 自动断句
  async function enableVad(callback: (text: string) => void) {
    if (vadActive.value) return
    onTranscribed = callback
    vad.setThreshold(getVadThreshold())
    vad.setSilenceTimeout(getVadSilence())
    try {
      const stream = await acquireMic()
      vadActive.value = true
      await vad.start({
        onSpeechStart: () => {
          if (!recordingActive.value) {
            startRecording().catch((err) => console.warn('[Deskpet] Failed to start recording:', err))
          }
        },
        onSpeechEnd: () => { void stopRecording() },
        // 桌宠正在用 TTS 说话时不听，否则会把自己的声音当成用户输入
        shouldListen: () => !store.isSpeaking,
        // 抑制只停掉检测，已开录的 MediaRecorder 必须显式取消，否则 TTS 全被录进去
        onSuppress: () => cancelRecording(),
      }, stream)
    } catch (err) {
      console.warn('[Deskpet] Failed to start VAD:', err)
      vadActive.value = false
      onTranscribed = null
      releaseMicIfIdle()
      throw err
    }
  }

  function disableVad() {
    vadActive.value = false
    onTranscribed = null
    vad.stop()
    // 用户主动关 VAD，半截录音没有意义，取消而不是转写
    cancelRecording()
    releaseMicIfIdle()
  }

  /** 组件卸载时释放麦克风/AudioContext/定时器 */
  function cleanup() {
    disableVad()
    cancelRecording()
    releaseMicIfIdle()
  }

  return {
    start,
    stop,
    recordingActive: readonly(recordingActive),
    vadActive: readonly(vadActive),
    enableVad,
    disableVad,
    cleanup,
  }
}

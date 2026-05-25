import { useVad } from './useVad'

function getSttUrl(): string {
  try { return localStorage.getItem('deskpet/stt-url') || 'http://127.0.0.1:18530/stt' } catch { return 'http://127.0.0.1:18530/stt' }
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
  let mediaRecorder: MediaRecorder | null = null
  let recStream: MediaStream | null = null
  let chunks: Blob[] = []
  let recording = false
  let resolvePromise: ((text: string | null) => void) | null = null
  let vadActive = false
  let onTranscribed: ((text: string) => void) | null = null
  const vad = useVad()

  async function startRecording(): Promise<void> {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(recStream, { mimeType: 'audio/webm' })
    chunks = []
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    mediaRecorder.onstop = async () => {
      recStream!.getTracks().forEach((t) => t.stop())
      recording = false
      try {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const raw = await blob.arrayBuffer()
        const ctx = new AudioContext()
        const audio = await ctx.decodeAudioData(raw)
        const pcm = audio.getChannelData(0)
        const wav = encodeWav(pcm, audio.sampleRate)
        const text = await window.electronAPI?.sttTranscribe(wav, getSttUrl())
        if (text && onTranscribed) onTranscribed(text)
        resolvePromise?.(text || null)
      } catch { resolvePromise?.(null) }
      resolvePromise = null
    }
    mediaRecorder.start()
    recording = true
  }

  function stopRecording(): Promise<string | null> {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') { recording = false; return Promise.resolve(null) }
    return new Promise((resolve) => { resolvePromise = resolve; mediaRecorder!.stop() })
  }

  // manual
  async function start(): Promise<void> { await startRecording() }
  function stop(): Promise<string | null> { return stopRecording() }
  function isRecording(): boolean { return recording }

  // VAD auto
  function enableVad(callback: (text: string) => void) {
    if (vadActive) return
    vadActive = true
    onTranscribed = callback
    vad.setThreshold(parseFloat(localStorage.getItem('deskpet/vad-threshold') || '0.02'))
    vad.setSilenceTimeout(parseFloat(localStorage.getItem('deskpet/vad-silence') || '1.5'))
    vad.start({
      onSpeechStart: () => { if (!recording) startRecording() },
      onSpeechEnd: () => stopRecording().then(() => {}),
    })
  }

  function disableVad() {
    vadActive = false
    onTranscribed = null
    vad.stop()
  }

  return { start, stop, isRecording, enableVad, disableVad }
}

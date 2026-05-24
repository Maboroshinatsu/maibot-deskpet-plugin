function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataLength = samples.length * bytesPerSample
  const buf = new ArrayBuffer(44 + dataLength)
  const v = new DataView(buf)

  const w = (p: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + dataLength, true); w(8, 'WAVE')
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, numChannels, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  v.setUint16(32, numChannels * bytesPerSample, true); v.setUint16(34, bitsPerSample, true)
  w(36, 'data'); v.setUint32(40, dataLength, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s * 0x7FFF, true)
  }
  return buf
}

export function useVoiceInput() {
  let mediaRecorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let recording = false

  async function start(): Promise<void> {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    recording = true
  }

  function stop(): Promise<string | null> {
    if (!mediaRecorder || !stream) return Promise.resolve(null)

    return new Promise((resolve) => {
      const chunks: Blob[] = []
      mediaRecorder!.ondataavailable = (e) => chunks.push(e.data)
      mediaRecorder!.onstop = async () => {
        stream!.getTracks().forEach((t) => t.stop())
        recording = false
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const raw = await blob.arrayBuffer()
          const ctx = new AudioContext()
          const audio = await ctx.decodeAudioData(raw)
          const pcm = audio.getChannelData(0)
          const wav = encodeWav(pcm, audio.sampleRate)
          const text = await window.electronAPI?.sttTranscribe(wav)
          resolve(text || null)
        } catch {
          resolve(null)
        }
      }
      mediaRecorder!.start()
      setTimeout(() => {
        if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
      }, 10000)
    })
  }

  function isRecording(): boolean {
    return recording
  }

  return { start, stop, isRecording }
}

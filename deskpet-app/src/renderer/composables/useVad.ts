let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let stream: MediaStream | null = null
let running = false
let animFrame = 0

interface VadCallbacks {
  onSpeechStart: () => void
  onSpeechEnd: () => void
}

export function useVad() {
  let threshold = 0.02
  let silenceTimeout = 1.5
  let speechFrames = 0
  let silenceFrames = 0
  const SPEECH_START_FRAMES = 8  // ~200ms at ~40fps
  let callbacks: VadCallbacks | null = null
  let speaking = false

  function setThreshold(v: number) { threshold = v }
  function setSilenceTimeout(s: number) { silenceTimeout = s }

  async function start(cb: VadCallbacks) {
    if (running) return
    callbacks = cb
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioCtx = new AudioContext()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.3
    const source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)
    running = true
    tick()
  }

  function stop() {
    running = false
    speaking = false
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = 0 }
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    audioCtx?.close()
    audioCtx = null
    analyser = null
    callbacks = null
  }

  function tick() {
    if (!running || !analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
    const rms = Math.sqrt(sum / data.length)

    if (rms > threshold) {
      silenceFrames = 0
      speechFrames++
      if (!speaking && speechFrames >= SPEECH_START_FRAMES) {
        speaking = true
        callbacks?.onSpeechStart()
      }
    } else {
      speechFrames = 0
      if (speaking) {
        silenceFrames++
        const silenceDuration = silenceFrames / 40  // ~40fps
        if (silenceDuration >= silenceTimeout) {
          speaking = false
          silenceFrames = 0
          callbacks?.onSpeechEnd()
        }
      }
    }
    animFrame = requestAnimationFrame(tick)
  }

  return { start, stop, setThreshold, setSilenceTimeout }
}

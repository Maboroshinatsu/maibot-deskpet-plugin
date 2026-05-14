let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let source: MediaElementAudioSourceNode | null = null
let active = false

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

export function useLipSync() {
  function attach(audio: HTMLAudioElement) {
    detach()

    const ctx = getAudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 64
    analyser.smoothingTimeConstant = 0.2
    source = ctx.createMediaElementSource(audio)
    source.connect(analyser)
    analyser.connect(ctx.destination)
    active = true
  }

  function detach() {
    try { source?.disconnect() } catch { /* ignore */ }
    try { analyser?.disconnect() } catch { /* ignore */ }
    source = null
    analyser = null
    active = false
  }

  let smoothed = 0
  const ATTACK = 0.4
  const RELEASE = 0.08

  function getMouthOpen(): number {
    if (!active || !analyser) {
      smoothed *= 0.9
      if (smoothed < 0.001) smoothed = 0
      return smoothed
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(data)

    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / data.length)
    const target = Math.min(1, rms * 5)

    const rate = target > smoothed ? ATTACK : RELEASE
    smoothed += (target - smoothed) * rate

    return smoothed
  }

  return { attach, detach, getMouthOpen }
}

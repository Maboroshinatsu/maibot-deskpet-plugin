let phase = 0
let speaking = false
let mouthValue = 0
const DECAY = 0.92

export function useLipSync() {
  function start() {
    speaking = true
  }

  function stop() {
    speaking = false
  }

  function getMouthOpen(): number {
    if (speaking) {
      phase += 0.18
      // NachoBot multi-sine formula
      mouthValue = 0.4 * Math.sin(phase * 2.5) + 0.3 * Math.sin(phase * 1.8) + 0.3 * Math.sin(phase * 3.3)
      // normalize to 0-1
      mouthValue = Math.abs(mouthValue)
    } else {
      mouthValue *= DECAY
      if (mouthValue < 0.001) mouthValue = 0
    }
    return mouthValue
  }

  return { start, stop, getMouthOpen }
}

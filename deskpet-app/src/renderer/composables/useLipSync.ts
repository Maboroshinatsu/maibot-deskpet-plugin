/**
 * 唇形同步状态（NachoBot 多正弦波叠加算法）
 *
 * 注意：这是**模块级单例**——useWebSocket（TTS 播放时 start/stop）与
 * DeskpetStage（每帧 getMouthOpen 渲染嘴型）刻意共享同一份状态。
 * 拆成每组件独立实例会导致「在播放但嘴不动」，改动时保持单例语义。
 */
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

import { useDeskpetStore } from '@/stores/deskpet'
import { playMotion } from '@/services/live2d/loader'

export enum MotionLayer {
  Idle = 1,
  Reply = 2,
  Interaction = 3,
}

export function useMotionPriority(store: ReturnType<typeof useDeskpetStore>) {
  let currentLayer: MotionLayer | null = null
  // 每次播放发一个令牌：释放定时器只认自己那次播放，
  // 否则同层新动作会被旧动作的定时器提前解除保护
  let playToken = 0

  function playMotionWithPriority(
    motion: string,
    layer: MotionLayer,
    index: number = 0,
  ): boolean {
    if (currentLayer !== null && layer < currentLayer) return false

    const model = store.live2dModel
    if (!model) return false

    currentLayer = layer
    const token = ++playToken
    playMotion(model, motion, index)

    if (layer !== MotionLayer.Idle) {
      setTimeout(() => {
        if (playToken === token && currentLayer === layer) {
          currentLayer = null
        }
      }, 5000)
    }

    return true
  }

  /** 模型热切换后必须重置，否则旧模型留下的层级会挡住新模型的动作 */
  function reset() {
    currentLayer = null
    playToken++
  }

  return { playMotionWithPriority, reset }
}

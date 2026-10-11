import { useDeskpetStore } from '@/stores/deskpet'
import { onMotionFinish, playMotion } from '@/services/live2d/loader'

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
  // 循环令牌：任何新播放 / 停止 / 换模型都会作废旧循环的续播
  let loopToken = 0
  let loopCleanup: (() => void) | null = null
  let looping = false

  /** 停止循环：令牌递增 + 退订事件，在途续播回调自动失效 */
  function stopLoop() {
    loopToken++
    looping = false
    if (loopCleanup) {
      loopCleanup()
      loopCleanup = null
    }
  }

  function playMotionWithPriority(
    motion: string,
    layer: MotionLayer,
    index: number = 0,
    options?: { loop?: boolean },
  ): boolean {
    if (currentLayer !== null && layer < currentLayer) return false

    const model = store.live2dModel
    if (!model) return false

    currentLayer = layer
    const token = ++playToken
    // 新播放接管循环所有权，先作废上一条循环
    stopLoop()
    const wantLoop = !!options?.loop
    const myLoop = loopToken

    void playMotion(model, motion, index).then((started) => {
      if (playToken !== token || myLoop !== loopToken) return
      if (!started) {
        // 模型没有这条动作：不虚报成功，也不占用动作层级
        if (currentLayer === layer) currentLayer = null
        return
      }
      if (!wantLoop) return
      // 自然结束时续播；播放期间若换模型/换动作/显式停止，令牌不匹配即自动停止
      loopCleanup = onMotionFinish(model, () => {
        if (myLoop !== loopToken || playToken !== token) return
        if (store.live2dModel !== model || currentLayer !== layer) return
        void playMotion(model, motion, index)
      })
      looping = true
    })

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
    stopLoop()
  }

  return { playMotionWithPriority, stopLoop, isLooping: () => looping, reset }
}

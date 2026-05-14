import { useDeskpetStore } from '@/stores/deskpet'
import { playMotion } from '@/services/live2d/loader'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { Cubism4ModelSettings } from 'pixi-live2d-display/cubism4'

export enum MotionLayer {
  Idle = 1,
  Reply = 2,
  Interaction = 3,
}

type Model = Live2DModel<Cubism4ModelSettings>

export function useMotionPriority(store: ReturnType<typeof useDeskpetStore>) {
  let currentLayer: MotionLayer | null = null

  function playMotionWithPriority(
    motion: string,
    layer: MotionLayer,
    index: number = 0,
  ): boolean {
    if (currentLayer !== null && layer < currentLayer) return false

    const model = store.live2dModel as Model | null
    if (!model) return false

    currentLayer = layer
    playMotion(model, motion, index)

    if (layer !== MotionLayer.Idle) {
      setTimeout(() => {
        if (currentLayer === layer) {
          currentLayer = null
        }
      }, 5000)
    }

    return true
  }

  function releaseIdle() {
    if (currentLayer === MotionLayer.Idle) {
      currentLayer = null
    }
  }

  return { playMotionWithPriority, releaseIdle }
}

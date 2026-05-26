import { watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { setExpression } from '@/services/live2d/loader'
import { getEmotionTarget } from '@/services/live2d/emotion-adapter'

const EXPRESSION_DURATION_MS = 6000

export function useExpressionState(store: ReturnType<typeof useDeskpetStore>) {
  let revertTimer: ReturnType<typeof setTimeout> | null = null

  function applyExpression(emotion: string) {
    const model = store.live2dModel
    if (!model) return

    const target = getEmotionTarget(store.emotionAdapter, emotion)
    if (!target?.expression) return

    setExpression(model, target.expression)
  }

  function clearRevertTimer() {
    if (revertTimer) {
      clearTimeout(revertTimer)
      revertTimer = null
    }
  }

  watch(
    () => store.currentEmotion,
    (emotion) => {
      clearRevertTimer()
      applyExpression(emotion)

      if (emotion !== 'neutral' && emotion !== 'idle') {
        revertTimer = setTimeout(() => {
          revertTimer = null
          applyExpression('neutral')
        }, EXPRESSION_DURATION_MS)
      }
    },
  )

  function cleanup() {
    clearRevertTimer()
  }

  return { cleanup }
}

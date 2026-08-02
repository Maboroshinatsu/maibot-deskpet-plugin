import { watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { applyParameters, clearExpression, setExpression } from '@/services/live2d/loader'
import { getEmotionTarget } from '@/services/live2d/emotion-adapter'

const EXPRESSION_DURATION_MS = 6000

export function useExpressionState(store: ReturnType<typeof useDeskpetStore>) {
  let revertTimer: ReturnType<typeof setTimeout> | null = null
  let expressionActive = false

  function applyEmotionState(emotion: string) {
    const model = store.live2dModel
    if (!model) return

    const target = getEmotionTarget(store.emotionAdapter, emotion)

    if (target?.expression) {
      setExpression(model, target.expression)
      expressionActive = true
    } else if (expressionActive) {
      // 目标情绪不带表情（含未映射的 neutral）时必须显式淡出，
      // 否则上一个表情会永久残留
      clearExpression(model)
      expressionActive = false
    }
    if (target?.parameters) {
      applyParameters(model, target.parameters)
    } else {
      // 目标情绪没有声明参数（含 6 秒后回退到的 neutral）时必须显式释放，
      // 否则上一个情绪的 parameters（腮红/眼泪等）会永久残留在模型上
      applyParameters(model, {})
    }
  }

  function clearRevertTimer() {
    if (revertTimer) {
      clearTimeout(revertTimer)
      revertTimer = null
    }
  }

  // 同时观察 pulse：相同情绪连发也要重放，并刷新 6 秒回退窗口
  watch(
    () => [store.currentEmotion, store.emotionPulse] as const,
    ([emotion]) => {
      clearRevertTimer()
      applyEmotionState(emotion)

      // 回退目标：静态立绘包标定的 default；Live2D 的 neutral/idle 视为常态不回退
      if (emotion !== store.defaultEmotion && emotion !== 'neutral' && emotion !== 'idle') {
        revertTimer = setTimeout(() => {
          revertTimer = null
          store.currentEmotion = store.defaultEmotion || 'neutral'
        }, EXPRESSION_DURATION_MS)
      }
    },
  )

  function cleanup() {
    clearRevertTimer()
  }

  return { cleanup }
}

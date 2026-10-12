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
    if (emotion !== 'neutral' && emotion !== 'idle' && target?.parameters) {
      applyParameters(model, target.parameters)
    } else {
      // neutral/idle 常态或目标情绪没有声明参数时必须显式清空 stack.emotion，
      // 否则 neutral 的默认参数会常驻在 stack.emotion 层并覆盖 stack.controls（预设与面捕滑块）
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

      // 回退归属：本控制器只负责 Live2D 模型。立绘包的回退由 StaticStage 负责，
      // 否则同一情绪会有两个定时器重复回退（DP-014）
      if (!store.live2dModel) return

      // 回退目标：Live2D 的 neutral/idle 视为常态不回退
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

import { ref, onUnmounted } from 'vue'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { Cubism4ModelSettings } from 'pixi-live2d-display/cubism4'

interface AnimationState {
  blinkTimer: ReturnType<typeof setTimeout> | null
  isBlinkClosing: boolean
  nextBlinkAt: number
  eyeFocusX: number
  eyeFocusY: number
  nextSaccadeAt: number
  breathPhase: number
  animFrameId: number
}

export function useLive2DAnimation() {
  const animationEnabled = ref(true)
  const mouseX = ref(0.5)
  const mouseY = ref(0.5)
  const breathIntensity = ref(0.3)

  const state: AnimationState = {
    blinkTimer: null,
    isBlinkClosing: false,
    nextBlinkAt: 0,
    eyeFocusX: 0,
    eyeFocusY: 0,
    nextSaccadeAt: 0,
    breathPhase: 0,
    animFrameId: 0
  }

  function start(model: Live2DModel<Cubism4ModelSettings>) {
    scheduleBlink(model)
    startBreath(model)
  }

  function stop() {
    if (state.blinkTimer) {
      clearTimeout(state.blinkTimer)
      state.blinkTimer = null
    }
    if (state.animFrameId) {
      cancelAnimationFrame(state.animFrameId)
      state.animFrameId = 0
    }
  }

  function scheduleBlink(model: Live2DModel<Cubism4ModelSettings>) {
    if (!animationEnabled.value) return

    const interval = 2000 + Math.random() * 5000
    state.nextBlinkAt = Date.now() + interval

    state.blinkTimer = setTimeout(() => {
      executeBlink(model)
    }, interval)
  }

  function executeBlink(model: Live2DModel<Cubism4ModelSettings>) {
    const internalModel = model.internalModel
    const coreModel = internalModel.coreModel

    const blinkClose = () => {
      coreModel.setParameterValueById('ParamEyeLOpen', 0)
      coreModel.setParameterValueById('ParamEyeROpen', 0)

      setTimeout(() => {
        blinkOpen()
      }, 75)
    }

    const blinkOpen = () => {
      coreModel.setParameterValueById('ParamEyeLOpen', 1)
      coreModel.setParameterValueById('ParamEyeROpen', 1)

      scheduleBlink(model)
    }

    blinkClose()
  }

  function startBreath(model: Live2DModel<Cubism4ModelSettings>) {
    const internalModel = model.internalModel
    const coreModel = internalModel.coreModel
    let startTime = performance.now()

    const tick = () => {
      if (!animationEnabled.value) {
        state.animFrameId = requestAnimationFrame(tick)
        return
      }

      const elapsed = (performance.now() - startTime) / 1000
      const breathValue = Math.sin(elapsed * 1.2) * breathIntensity.value
      coreModel.setParameterValueById('ParamBreath', breathValue)

      state.animFrameId = requestAnimationFrame(tick)
    }

    state.animFrameId = requestAnimationFrame(tick)
  }

  onUnmounted(() => {
    stop()
  })

  return { animationEnabled, mouseX, mouseY, breathIntensity, start, stop }
}

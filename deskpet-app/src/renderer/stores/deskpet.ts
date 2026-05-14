import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { Application } from '@pixi/app'

interface PersistedModelViewState {
  zoom: number
  offsetX: number
  offsetY: number
}

const MODEL_VIEW_STATE_KEY = 'deskpet/model-view'
const UI_STATE_KEY = 'deskpet/ui-state'
const DEFAULT_MODEL_VIEW_STATE: PersistedModelViewState = {
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
}

interface PersistedUiState {
  hoverFadeEnabled: boolean
}

const DEFAULT_UI_STATE: PersistedUiState = {
  hoverFadeEnabled: false,
}

function loadModelViewState(): PersistedModelViewState {
  try {
    const raw = localStorage.getItem(MODEL_VIEW_STATE_KEY)
    if (!raw) return { ...DEFAULT_MODEL_VIEW_STATE }
    const parsed = JSON.parse(raw) as Partial<PersistedModelViewState>
    return {
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : DEFAULT_MODEL_VIEW_STATE.zoom,
      offsetX: typeof parsed.offsetX === 'number' ? parsed.offsetX : DEFAULT_MODEL_VIEW_STATE.offsetX,
      offsetY: typeof parsed.offsetY === 'number' ? parsed.offsetY : DEFAULT_MODEL_VIEW_STATE.offsetY,
    }
  } catch {
    return { ...DEFAULT_MODEL_VIEW_STATE }
  }
}

function loadUiState(): PersistedUiState {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY)
    if (!raw) return { ...DEFAULT_UI_STATE }
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>
    return {
      hoverFadeEnabled: typeof parsed.hoverFadeEnabled === 'boolean' ? parsed.hoverFadeEnabled : DEFAULT_UI_STATE.hoverFadeEnabled,
    }
  } catch {
    return { ...DEFAULT_UI_STATE }
  }
}

export const useDeskpetStore = defineStore('deskpet', () => {
  const persistedModelView = loadModelViewState()
  const persistedUiState = loadUiState()
  const wsConnected = ref(false)
  const pixiApp = shallowRef<Application | null>(null)
  const live2dModel = shallowRef<Live2DModel | null>(null)
  const modelLoaded = ref(false)
  const modelZoom = ref(persistedModelView.zoom)
  const modelOffsetX = ref(persistedModelView.offsetX)
  const modelOffsetY = ref(persistedModelView.offsetY)
  const hoverFadeEnabled = ref(persistedUiState.hoverFadeEnabled)

  watch(hoverFadeEnabled, (enabled) => {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({ hoverFadeEnabled: enabled }))
  })

  watch([modelZoom, modelOffsetX, modelOffsetY], ([zoom, offsetX, offsetY]) => {
    localStorage.setItem(MODEL_VIEW_STATE_KEY, JSON.stringify({ zoom, offsetX, offsetY }))
  })

  const currentEmotion = ref('neutral')
  const isThinking = ref(false)
  const pendingAnimation = ref<string | null>(null)
  const pendingAnimationLoop = ref(false)

  function consumePendingAnimation(): { name: string; loop: boolean } | null {
    if (!pendingAnimation.value) return null
    const result = { name: pendingAnimation.value, loop: pendingAnimationLoop.value }
    pendingAnimation.value = null
    pendingAnimationLoop.value = false
    return result
  }

  function setModelOffset(x: number, y: number) {
    modelOffsetX.value = x
    modelOffsetY.value = y
  }

  function resetModelView() {
    modelZoom.value = DEFAULT_MODEL_VIEW_STATE.zoom
    modelOffsetX.value = DEFAULT_MODEL_VIEW_STATE.offsetX
    modelOffsetY.value = DEFAULT_MODEL_VIEW_STATE.offsetY
  }

  return {
    wsConnected,
    pixiApp,
    live2dModel,
    modelLoaded,
    modelZoom,
    modelOffsetX,
    modelOffsetY,
    hoverFadeEnabled,
    currentEmotion,
    isThinking,
    pendingAnimation,
    pendingAnimationLoop,
    consumePendingAnimation,
    setModelOffset,
    resetModelView
  }
})

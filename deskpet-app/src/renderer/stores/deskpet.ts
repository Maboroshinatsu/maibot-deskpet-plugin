import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import type { Application } from '@pixi/app'
import type { DeskpetModel, ModelCapabilities } from '@/services/live2d/loader'
import type { ModelEmotionAdapter } from '@/services/live2d/emotion-adapter'

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
  const live2dModel = shallowRef<DeskpetModel | null>(null)
  const emotionAdapter = shallowRef<ModelEmotionAdapter | null>(null)
  /** 当前模型的动作组/表情/参数清单，供适配校验和 deskpetInspectModel() 使用 */
  const modelCapabilities = shallowRef<ModelCapabilities | null>(null)
  const modelLoaded = ref(false)
  const modelUrl = ref('')
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
  /** 每次收到情绪指令递增；同值情绪连发时 watch([currentEmotion, emotionPulse]) 仍会触发 */
  const emotionPulse = ref(0)
  /** 当前模型声明的自定义情绪键（adapter / 立绘包清单的键），模型切换时更新 */
  const modelEmotions = ref<string[]>([])
  /** 情绪自动回退的目标（静态立绘包 = 清单标定的 default；Live2D 固定 neutral） */
  const defaultEmotion = ref('neutral')
  const isThinking = ref(false)
  /** TTS 正在出声：VAD 靠它避免把桌宠自己的声音听回去 */
  const isSpeaking = ref(false)
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

  // 真正的热切换逻辑住在 DeskpetStage（那里才拿得到 PixiJS 舞台），
  // 这里只留一个挂载点，设置面板通过 requestModelSwitch 触发。
  let modelSwitcher: ((url: string) => Promise<void>) | null = null

  function registerModelSwitcher(fn: (url: string) => Promise<void>) {
    modelSwitcher = fn
  }

  async function requestModelSwitch(url: string): Promise<void> {
    if (!modelSwitcher) {
      console.warn('[Deskpet] No model switcher registered')
      return
    }
    await modelSwitcher(url)
  }

  return {
    wsConnected,
    pixiApp,
    live2dModel,
    emotionAdapter,
    modelCapabilities,
    modelLoaded,
    modelUrl,
    modelZoom,
    modelOffsetX,
    modelOffsetY,
    hoverFadeEnabled,
    currentEmotion,
    emotionPulse,
    modelEmotions,
    defaultEmotion,
    isThinking,
    isSpeaking,
    pendingAnimation,
    pendingAnimationLoop,
    consumePendingAnimation,
    setModelOffset,
    resetModelView,
    registerModelSwitcher,
    requestModelSwitch
  }
})

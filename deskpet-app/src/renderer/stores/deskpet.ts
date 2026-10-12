import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { Application } from '@pixi/app'
import type { DeskpetModel, ModelCapabilities } from '@/services/live2d/loader'
import {
  buildModelStatePresets,
  getPresetDefaultFinishMode,
  normalizePresetSteps,
  resolvePresetGroup,
  type ModelEmotionAdapter,
  type ModelStatePreset,
  type PresetFinishMode,
  type PresetKeyframeStep,
  type ResolvedModelControl,
  type ResolvedModelSlider,
} from '@/services/live2d/emotion-adapter'
import type { DeskpetControlAction } from '@/services/host/contracts'

export interface SavePresetOptions {
  group?: string
  steps?: PresetKeyframeStep[]
  finishMode?: PresetFinishMode
  revertHoldMs?: number
  motion?: { group: string; index?: number } | 'none'
}

interface PersistedModelViewState {
  zoom: number
  offsetX: number
  offsetY: number
}

const MODEL_VIEW_STATE_KEY = 'deskpet/model-view'
const UI_STATE_KEY = 'deskpet/ui-state-biophilic-v1'
const LEGACY_UI_STATE_KEY = 'deskpet/ui-state'
const STATE_PRESETS_KEY = 'deskpet/state-presets-v3'
const DEFAULT_MODEL_VIEW_STATE: PersistedModelViewState = {
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
}

export type DeskpetThemeMode = 'dark' | 'light'
export type DeskpetOrbAction =
  | 'model_picker'
  | 'toggle_display_mode'
  | 'color_picker'
  | 'toggle_theme'

export const THEME_ACCENT_PRESETS = [
  { name: '琥珀暖棕', color: '#c87137' },
  { name: '苔藓森绿', color: '#2c5e28' },
  { name: '鼠尾草青', color: '#2e6b62' },
  { name: '矿石蓝灰', color: '#465c7a' },
  { name: '山茶暗粉', color: '#8f4a5e' },
  { name: '麦穗暖金', color: '#8a6a2f' },
] as const

interface PersistedUiState {
  hoverFadeEnabled: boolean
  themeMode: DeskpetThemeMode
  accentColor: string
  orbAction: DeskpetOrbAction
}

const DEFAULT_UI_STATE: PersistedUiState = {
  hoverFadeEnabled: false,
  themeMode: 'light',
  accentColor: '#c87137',
  orbAction: 'model_picker',
}

function isValidOrbAction(val: unknown): val is DeskpetOrbAction {
  return (
    val === 'model_picker' ||
    val === 'toggle_display_mode' ||
    val === 'color_picker' ||
    val === 'toggle_theme'
  )
}

function normalizeHexColor(input: unknown, fallback = '#c87137'): string {
  if (typeof input !== 'string') return fallback
  const trimmed = input.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : fallback
}

function hexToRgbNumbers(hex: string): [number, number, number] {
  const clean = normalizeHexColor(hex).slice(1)
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return [r, g, b]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0)
  } else if (max === gn) {
    h = (bn - rn) / d + 2
  } else {
    h = (rn - gn) / d + 4
  }
  return [Math.round(h * 60), s, l]
}

function applyThemeCssVariables(mode: DeskpetThemeMode, accent: string): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const validAccent = normalizeHexColor(accent)
  const [r, g, b] = hexToRgbNumbers(validAccent)
  const [h, s, l] = rgbToHsl(r, g, b)

  root.setAttribute('data-theme', mode)
  root.style.setProperty('--dp-accent', validAccent)
  root.style.setProperty('--dp-accent-rgb', `${r}, ${g}, ${b}`)

  // 根据选定主题色的实际亮度动态决定实心胶囊上的文字颜色，避免浅亮色块上白字看不清
  const relativeLum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  root.style.setProperty('--dp-accent-text', relativeLum > 0.64 ? '#141816' : '#ffffff')

  if (mode === 'dark') {
    // 夜间模式：固定深邃纯净暗底，仅注入极低饱和度（<=7%）的同色相微冷暖倾向，彻底杜绝取色混色发脏发灰
    const darkSat = s < 0.06 ? 0 : Math.min(7, Math.round(s * 14))
    const wellSat = s < 0.06 ? 0 : Math.min(9, Math.round(s * 18))
    const vividSat = s < 0.08 ? 0 : Math.max(58, Math.min(88, Math.round(s * 100)))
    const vividLight = Math.max(68, Math.min(80, Math.round(l * 100)))

    root.style.setProperty('--dp-panel-bg', `hsl(${h} ${darkSat}% 10%)`)
    root.style.setProperty('--dp-bg', `hsl(${h} ${darkSat}% 10%)`)
    root.style.setProperty('--dp-card-bg', `hsl(${h} ${wellSat}% 14.5%)`)
    root.style.setProperty('--dp-bg-elevated', `hsl(${h} ${wellSat}% 14.5%)`)
    root.style.setProperty('--dp-surface', `hsl(${h} ${wellSat}% 14.5%)`)
    root.style.setProperty('--dp-card-hover', `hsl(${h} ${wellSat}% 18.5%)`)
    root.style.setProperty('--dp-surface-hover', `hsl(${h} ${wellSat}% 18.5%)`)
    root.style.setProperty('--dp-pill-inner', `hsl(${h} ${darkSat}% 19.5%)`)
    root.style.setProperty('--dp-input-bg', `hsl(${h} ${darkSat}% 11.5%)`)
    root.style.setProperty('--dp-bubble-bg', `hsl(${h} ${darkSat}% 11% / 0.96)`)
    root.style.setProperty('--dp-dock-bg', `hsl(${h} ${darkSat}% 11% / 0.92)`)
    root.style.setProperty('--dp-accent-vivid', `hsl(${h} ${vividSat}% ${vividLight}%)`)
  } else {
    // 日间模式：恢复白瓷与暖燕麦纯净底色
    root.style.removeProperty('--dp-panel-bg')
    root.style.removeProperty('--dp-bg')
    root.style.removeProperty('--dp-card-bg')
    root.style.removeProperty('--dp-bg-elevated')
    root.style.removeProperty('--dp-surface')
    root.style.removeProperty('--dp-card-hover')
    root.style.removeProperty('--dp-surface-hover')
    root.style.removeProperty('--dp-pill-inner')
    root.style.removeProperty('--dp-input-bg')
    root.style.removeProperty('--dp-bubble-bg')
    root.style.removeProperty('--dp-dock-bg')
    const dayVividLight = Math.min(42, Math.max(24, Math.round(l * 100)))
    const dayVividSat = s < 0.08 ? 0 : Math.max(45, Math.round(s * 100))
    root.style.setProperty('--dp-accent-vivid', `hsl(${h} ${dayVividSat}% ${dayVividLight}%)`)
  }
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
    if (!raw) {
      const legacyRaw = localStorage.getItem(LEGACY_UI_STATE_KEY)
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw) as Partial<PersistedUiState>
        return {
          ...DEFAULT_UI_STATE,
          hoverFadeEnabled:
            typeof legacyParsed.hoverFadeEnabled === 'boolean'
              ? legacyParsed.hoverFadeEnabled
              : DEFAULT_UI_STATE.hoverFadeEnabled,
        }
      }
      return { ...DEFAULT_UI_STATE }
    }
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>
    return {
      hoverFadeEnabled: typeof parsed.hoverFadeEnabled === 'boolean' ? parsed.hoverFadeEnabled : DEFAULT_UI_STATE.hoverFadeEnabled,
      themeMode: parsed.themeMode === 'light' || parsed.themeMode === 'dark' ? parsed.themeMode : DEFAULT_UI_STATE.themeMode,
      accentColor: normalizeHexColor(parsed.accentColor, DEFAULT_UI_STATE.accentColor),
      orbAction: isValidOrbAction(parsed.orbAction) ? parsed.orbAction : DEFAULT_UI_STATE.orbAction,
    }
  } catch {
    return { ...DEFAULT_UI_STATE }
  }
}

type PersistedPresetsMap = Record<string, ModelStatePreset[]>

function sanitizePresetObject(item: ModelStatePreset): ModelStatePreset {
  const cleanParams: Record<string, number> = {}
  if (item.parameters && typeof item.parameters === 'object') {
    for (const [pid, pval] of Object.entries(item.parameters)) {
      const num = Number(pval)
      if (pid && Number.isFinite(num)) cleanParams[pid] = num
    }
  }
  const controls = Array.isArray(item.controls)
    ? item.controls.map((c) => String(c).trim()).filter(Boolean)
    : []
  const steps = normalizePresetSteps({
    controls,
    parameters: cleanParams,
    steps: item.steps,
  })
  const lastStep = steps[steps.length - 1]
  const finishMode = getPresetDefaultFinishMode(item)
  return {
    id: String(item.id || ''),
    label: String(item.label || '').trim(),
    description: String(item.description || '').trim(),
    emotion: String(item.emotion || 'neutral').trim() || 'neutral',
    group: resolvePresetGroup(item),
    controls: lastStep ? [...lastStep.controls] : controls,
    parameters: lastStep ? { ...lastStep.parameters } : cleanParams,
    steps,
    finishMode,
    ...(typeof item.revertHoldMs === 'number' && Number.isFinite(item.revertHoldMs)
      ? { revertHoldMs: item.revertHoldMs }
      : {}),
    ...(item.motion ? { motion: item.motion } : {}),
    custom: true,
  }
}

function loadPresetsMap(): PersistedPresetsMap {
  try {
    const raw = localStorage.getItem(STATE_PRESETS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: PersistedPresetsMap = {}
    for (const [key, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue
      result[key] = list
        .filter((item): item is ModelStatePreset => !!item && typeof item === 'object')
        .map((item) => sanitizePresetObject(item))
        .filter((item) => item.id && item.label)
    }
    return result
  } catch {
    return {}
  }
}

function getModelPresetScopeKey(url: string): string {
  const trimmed = (url || '').trim()
  if (!trimmed) return 'default'
  return trimmed.replace(/[?#].*$/, '')
}

export const useDeskpetStore = defineStore('deskpet', () => {
  const persistedModelView = loadModelViewState()
  const persistedUiState = loadUiState()
  const presetsByModel = ref<PersistedPresetsMap>(loadPresetsMap())
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
  const clickThroughLocked = ref(false)
  const themeMode = ref<DeskpetThemeMode>(persistedUiState.themeMode)
  const accentColor = ref<string>(persistedUiState.accentColor)
  const orbAction = ref<DeskpetOrbAction>(persistedUiState.orbAction)

  applyThemeCssVariables(themeMode.value, accentColor.value)

  watch([hoverFadeEnabled, themeMode, accentColor, orbAction], ([enabled, mode, accent, orb]) => {
    const validAccent = normalizeHexColor(accent)
    applyThemeCssVariables(mode, validAccent)
    try {
      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          hoverFadeEnabled: enabled,
          themeMode: mode,
          accentColor: validAccent,
          orbAction: orb,
        }),
      )
    } catch { /* ignore storage quota errors */ }
  })

  watch([modelZoom, modelOffsetX, modelOffsetY], ([zoom, offsetX, offsetY]) => {
    localStorage.setItem(MODEL_VIEW_STATE_KEY, JSON.stringify({ zoom, offsetX, offsetY }))
  })

  function persistPresetsMap(syncDiskForCurrentModel = true) {
    try {
      localStorage.setItem(STATE_PRESETS_KEY, JSON.stringify(presetsByModel.value))
    } catch { /* ignore storage quota errors */ }
    if (syncDiskForCurrentModel && modelUrl.value) {
      try {
        const key = getModelPresetScopeKey(modelUrl.value)
        const list = presetsByModel.value[key]
        if (Array.isArray(list)) {
          const plainList = JSON.parse(JSON.stringify(list))
          void window.electronAPI?.saveModelPresets?.(String(modelUrl.value), plainList).catch(() => {})
        }
      } catch { /* ignore IPC serialization errors */ }
    }
  }

  const currentEmotion = ref('neutral')
  /** 每次收到情绪指令递增；同值情绪连发时 watch([currentEmotion, emotionPulse]) 仍会触发 */
  const emotionPulse = ref(0)
  /** 当前模型声明的自定义情绪键（adapter / 立绘包清单的键），模型切换时更新 */
  const modelEmotions = ref<string[]>([])
  /** 当前模型可用的控件列表（服饰/发型/道具/特效开关），随模型加载与开关变化同步到后端 */
  const modelControls = ref<ResolvedModelControl[]>([])
  /** 当前模型可调节的 VTB 面捕/五官/头身角度滑块列表 */
  const modelSliders = ref<ResolvedModelSlider[]>([])
  /** 情绪自动回退的目标（静态立绘包 = 清单标定的 default；Live2D 固定 neutral） */
  const defaultEmotion = ref('neutral')
  const isThinking = ref(false)
  /** TTS 正在出声：VAD 靠它避免把桌宠自己的声音听回去 */
  const isSpeaking = ref(false)
  const pendingAnimation = ref<string | null>(null)
  const pendingAnimationLoop = ref(false)

  /** 当前由用户显式钉为常驻基底保持的预设 ID（为空时播完恢复默认回退到 neutral 日常待机） */
  const activeHoldPresetId = ref<string>('')
  /** 当前正在执行或激活的预设 ID */
  const activeRunningPresetId = ref<string | null>('neutral')
  /** 当用户在设置面板展开预设进行分镜/滑块编辑时置为 true，暂停自动回退 */
  const presetEditingLocked = ref<boolean>(false)

  /**
   * 当模型加载完毕后，优先使用模型目录下的 deskpet-presets.json；
   * 若模型目录下尚无该文件，则采用已有缓存或初始种子预设并自动落盘到模型目录。
   */
  function ensureModelPresetsSeeded(diskPresets?: ModelStatePreset[] | null) {
    const key = getModelPresetScopeKey(modelUrl.value)
    activeHoldPresetId.value = ''
    activeRunningPresetId.value = 'neutral'
    if (Array.isArray(diskPresets) && diskPresets.length > 0) {
      presetsByModel.value = {
        ...presetsByModel.value,
        [key]: diskPresets.map((p) => sanitizePresetObject(p)),
      }
      persistPresetsMap(false)
      return
    }
    if (key in presetsByModel.value) {
      persistPresetsMap(true)
      return
    }
    const seeded = buildModelStatePresets(
      modelControls.value,
      modelEmotions.value,
      modelSliders.value,
    )
    presetsByModel.value = {
      ...presetsByModel.value,
      [key]: seeded,
    }
    persistPresetsMap(true)
  }

  /** 一键恢复当前模型的初始预设列表，并同步覆盖模型目录下的 deskpet-presets.json */
  function restoreDefaultPresets(): ModelStatePreset[] {
    const key = getModelPresetScopeKey(modelUrl.value)
    const seeded = buildModelStatePresets(
      modelControls.value,
      modelEmotions.value,
      modelSliders.value,
    )
    presetsByModel.value = {
      ...presetsByModel.value,
      [key]: seeded,
    }
    persistPresetsMap(true)
    return seeded
  }

  /** 当前模型的所有状态预设（全部可删除、可覆盖编辑，并暴露给后端 AI 调用） */
  const statePresets = computed<ModelStatePreset[]>(() => {
    const key = getModelPresetScopeKey(modelUrl.value)
    if (key in presetsByModel.value) {
      return presetsByModel.value[key]
    }
    return buildModelStatePresets(modelControls.value, modelEmotions.value, modelSliders.value)
  })

  /** 兼容旧引用的别名 */
  const customPresets = statePresets

  /**
   * 将当前控件、面捕滑块以及可选的多步关键帧序列保存为命名预设
   */
  function saveCustomPreset(
    label: string,
    controlIds?: string[],
    customParams?: Record<string, number>,
    emotion = 'neutral',
    options?: SavePresetOptions,
  ): ModelStatePreset | null {
    const cleanLabel = label.trim()
    if (!cleanLabel) return null

    // 默认收集所有激活控件（包括常驻外观服饰/发型）
    const fallbackActiveIds =
      controlIds !== undefined
        ? Array.from(new Set(controlIds.map((c) => c.trim()).filter(Boolean)))
        : modelControls.value.filter((c) => c.active).map((c) => c.id)

    // 默认收集所有偏离默认值的面捕/角度滑块参数
    const fallbackSliderParams: Record<string, number> = {}
    if (customParams !== undefined) {
      for (const [pid, val] of Object.entries(customParams)) {
        if (Number.isFinite(val)) fallbackSliderParams[pid] = Math.round(val * 100) / 100
      }
    } else {
      for (const s of modelSliders.value) {
        if (Math.abs(s.value - s.defaultValue) > 1e-3) {
          fallbackSliderParams[s.id] = Math.round(s.value * 100) / 100
        }
      }
    }

    const steps = normalizePresetSteps({
      controls: fallbackActiveIds,
      parameters: fallbackSliderParams,
      steps: options?.steps,
    })
    const lastStep = steps[steps.length - 1]
    const activeIds = lastStep ? [...lastStep.controls] : fallbackActiveIds
    const sliderParams = lastStep ? { ...lastStep.parameters } : fallbackSliderParams

    const ctrlLabelMap = new Map(
      modelControls.value.map((c) => [c.id, c.label.replace(/\s*\([^)]*\)\s*$/, '').trim() || c.id]),
    )
    const sliderLabelMap = new Map(modelSliders.value.map((s) => [s.id, s.label]))

    const ctrlNames = activeIds.map((id) => ctrlLabelMap.get(id) || id)
    const touchedParamSet = new Set<string>()
    for (const st of steps) {
      for (const pid of Object.keys(st.parameters)) touchedParamSet.add(pid)
    }
    const sliderNames = [...touchedParamSet].map((id) => sliderLabelMap.get(id) || id)
    const descParts: string[] = []
    if (steps.length > 1) {
      descParts.push(`${steps.length}步连续动作`)
    }
    if (ctrlNames.length > 0) {
      descParts.push(
        ctrlNames.slice(0, 3).join(' + ') + (ctrlNames.length > 3 ? ` 等${ctrlNames.length}项` : ''),
      )
    }
    if (sliderNames.length > 0) {
      descParts.push(
        `滑块(${sliderNames.slice(0, 2).join('/')}${sliderNames.length > 2 ? `等${sliderNames.length}项` : ''})`,
      )
    }
    const desc = descParts.join(' · ') || '默认外观与自然面捕'

    const key = getModelPresetScopeKey(modelUrl.value)
    const currentList =
      key in presetsByModel.value
        ? [...presetsByModel.value[key]]
        : [...buildModelStatePresets(modelControls.value, modelEmotions.value, modelSliders.value)]

    const existingIdx = currentList.findIndex(
      (p) => p.label.toLowerCase() === cleanLabel.toLowerCase(),
    )
    const existingPreset = existingIdx >= 0 ? currentList[existingIdx] : undefined

    const cleanEmotion = (emotion || 'neutral').trim() || 'neutral'
    const resolvedGroup = resolvePresetGroup({
      id: existingPreset?.id,
      label: cleanLabel,
      emotion: cleanEmotion,
      group: options?.group ?? existingPreset?.group,
    })

    const finishMode =
      options?.finishMode ??
      existingPreset?.finishMode ??
      getPresetDefaultFinishMode({
        id: existingPreset?.id,
        label: cleanLabel,
        emotion: cleanEmotion,
        group: resolvedGroup,
      })

    const revertHoldMs = options?.revertHoldMs ?? existingPreset?.revertHoldMs
    const motion = options?.motion !== undefined ? options.motion : existingPreset?.motion

    const preset: ModelStatePreset = {
      id: existingPreset ? existingPreset.id : `preset_${Date.now().toString(36)}`,
      label: cleanLabel,
      description: desc,
      emotion: cleanEmotion,
      group: resolvedGroup,
      controls: activeIds,
      parameters: sliderParams,
      steps,
      finishMode,
      ...(typeof revertHoldMs === 'number' ? { revertHoldMs } : {}),
      ...(motion !== undefined ? { motion } : {}),
      custom: true,
    }

    if (existingIdx >= 0) {
      currentList[existingIdx] = preset
    } else {
      currentList.push(preset)
    }

    presetsByModel.value = {
      ...presetsByModel.value,
      [key]: currentList,
    }
    persistPresetsMap(true)
    return preset
  }

  function deleteCustomPreset(id: string): boolean {
    const key = getModelPresetScopeKey(modelUrl.value)
    const currentList =
      key in presetsByModel.value
        ? [...presetsByModel.value[key]]
        : [...buildModelStatePresets(modelControls.value, modelEmotions.value, modelSliders.value)]
    const next = currentList.filter((p) => p.id !== id)
    if (next.length === currentList.length) return false
    if (activeHoldPresetId.value === id) {
      activeHoldPresetId.value = ''
    }
    presetsByModel.value = {
      ...presetsByModel.value,
      [key]: next,
    }
    persistPresetsMap(true)
    return true
  }

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

  let controlActionHandler: ((control: string, action: DeskpetControlAction) => boolean) | null = null
  let sliderSyncHandler: ((transitionMs?: number) => void) | null = null
  let presetTriggerHandler:
    | ((presetOrId: string | ModelStatePreset, modeOverride?: PresetFinishMode) => boolean)
    | null = null
  let stepPreviewHandler:
    | ((step: PresetKeyframeStep, gazeOverride?: boolean) => void)
    | null = null

  function registerControlHandler(fn: (control: string, action: DeskpetControlAction) => boolean) {
    controlActionHandler = fn
  }

  function registerSliderSyncHandler(fn: (transitionMs?: number) => void) {
    sliderSyncHandler = fn
  }

  function registerPresetTriggerHandler(
    fn: (presetOrId: string | ModelStatePreset, modeOverride?: PresetFinishMode) => boolean,
  ) {
    presetTriggerHandler = fn
  }

  function registerStepPreviewHandler(
    fn: (step: PresetKeyframeStep, gazeOverride?: boolean) => void,
  ) {
    stepPreviewHandler = fn
  }

  function applyControlAction(control: string, action: DeskpetControlAction = 'toggle'): boolean {
    if (!controlActionHandler) {
      console.warn('[Deskpet] No control handler registered')
      return false
    }
    return controlActionHandler(control, action)
  }

  function triggerPreset(
    presetOrId: string | ModelStatePreset,
    modeOverride?: PresetFinishMode,
  ): boolean {
    if (presetTriggerHandler) {
      return presetTriggerHandler(presetOrId, modeOverride)
    }
    const id = typeof presetOrId === 'string' ? presetOrId : presetOrId.id
    return applyControlAction(id, 'preset')
  }

  function previewPresetStep(step: PresetKeyframeStep, gazeOverride = true): void {
    stepPreviewHandler?.(step, gazeOverride)
  }

  function syncSlidersToModel(transitionMs = 0) {
    sliderSyncHandler?.(transitionMs)
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
    clickThroughLocked,
    themeMode,
    accentColor,
    orbAction,
    currentEmotion,
    emotionPulse,
    modelEmotions,
    modelControls,
    modelSliders,
    customPresets,
    statePresets,
    activeHoldPresetId,
    activeRunningPresetId,
    presetEditingLocked,
    ensureModelPresetsSeeded,
    restoreDefaultPresets,
    saveCustomPreset,
    deleteCustomPreset,
    defaultEmotion,
    isThinking,
    isSpeaking,
    pendingAnimation,
    pendingAnimationLoop,
    consumePendingAnimation,
    setModelOffset,
    resetModelView,
    registerModelSwitcher,
    requestModelSwitch,
    registerControlHandler,
    registerSliderSyncHandler,
    registerPresetTriggerHandler,
    registerStepPreviewHandler,
    applyControlAction,
    triggerPreset,
    previewPresetStep,
    syncSlidersToModel,
  }
})

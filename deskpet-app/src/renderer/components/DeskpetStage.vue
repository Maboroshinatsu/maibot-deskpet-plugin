<template>
  <div
    class="deskpet-stage"
    :class="{
      hovered: isHovered,
      'click-through-locked': store.clickThroughLocked,
      'hover-fade-enabled': store.hoverFadeEnabled,
      'model-faded': shouldFadeModel,
    }"
    :style="{ '--stage-shift-x': `${stageShiftX}px` }"
    @dblclick="onDoubleClick"
    @mousedown.left="onModelMouseDown"
    @contextmenu.prevent="onStageRightClick"
    @mouseenter="isHovered = true"
    @mouseleave="onMouseLeave"
  >
    <div class="stage-actor-layer">
      <div v-show="modelKind === 'live2d'" ref="stageRef" class="live2d-stage" />
      <StaticStage
        ref="staticStageRef"
        v-if="modelKind === 'image-set'"
        :hovered="shouldFadeModel"
      />
    </div>
    <div
      v-show="!store.clickThroughLocked"
      class="nav-bar"
      title="拖动窗口；双击重置模型位置和缩放；右键循环切换情绪"
      @mousedown.stop="onNavMouseDown"
      @dblclick.stop="resetModelView"
      @mouseenter="isUiHovered = true"
      @mouseleave="isUiHovered = false"
    />

    <!-- 侧边悬浮工具栏：悬停窗口才浮现（录音/VAD/伴随浮窗打开时常驻） -->
    <div
      class="btn-bar"
      :class="[{ visible: controlsVisible }, `dock-${popDirectionX}`]"
      @mouseenter="isUiHovered = true"
      @mouseleave="isUiHovered = false"
    >
      <button
        class="btn-bar-item"
        :class="{ active: showSettings }"
        @mousedown.stop
        @click.stop="toggleSettings"
        title="模型控件与设置"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="17" x2="20" y2="17" />
          <circle cx="9" cy="7" r="2.5" />
          <circle cx="15" cy="17" r="2.5" />
        </svg>
      </button>
      <button
        class="btn-bar-item"
        :class="{ active: chatPanelOpen }"
        @mousedown.stop
        @click.stop="toggleChatPanel"
        title="消息记录"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5 8.8 8.8 0 0 1-3.8-.85L3 21l1.45-5.2A8.45 8.45 0 0 1 3.5 12 8.5 8.5 0 0 1 12 3.5 8.5 8.5 0 0 1 21 12Z" />
          <line x1="8.5" y1="11" x2="15.5" y2="11" />
          <line x1="8.5" y1="14.5" x2="13" y2="14.5" />
        </svg>
      </button>
      <button
        class="btn-bar-item"
        :class="{ recording: recordingActive, vad: vadActive }"
        @mousedown.stop
        @click.stop="toggleVad"
        @contextmenu.prevent.stop="toggleManualRecording"
        :title="micTitle"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <line x1="12" y1="18" x2="12" y2="21" />
        </svg>
      </button>
    </div>

    <SettingsPanel
      :open="showSettings"
      :pop-direction-x="popDirectionX"
      :align-y="alignY"
      @close="showSettings = false"
    />

    <div v-if="modelError" class="model-error">
      <div class="error-icon">!</div>
      <p>{{ modelError }}</p>
      <p class="error-hint" v-if="modelError.includes('Cubism')">
        从 <a href="https://www.live2d.com/download/cubism-sdk/" target="_blank" style="color:#4fc3f7">Live2D 官网</a>
        下载 Cubism SDK for Web，解压后将 <code>Core/live2dcubismcore.min.js</code> 放到
        <code>src/renderer/public/</code> 下，然后在 <code>index.html</code> 中添加
        <code>&lt;script src="./live2dcubismcore.min.js"&gt;&lt;/script&gt;</code>
      </p>
      <p class="error-hint" v-else>将模型放入 <code>src/renderer/public/models/</code> 后重启应用</p>
    </div>

    <ChatBubble
      :messages="chatStore.messages"
      :last-bubble="chatStore.chatBubble"
      :panel-open="chatPanelOpen"
      :thinking="store.isThinking"
      :pop-direction-x="popDirectionX"
      :align-y="alignY"
      @bubbles-cleared="showInput = false; inputText = ''"
      @close="chatPanelOpen = false"
    />

    <QuickInput
      v-model="inputText"
      :visible="showInput"
      @submit="sendText"
      @blur="showInput = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import ChatBubble from './ChatBubble.vue'
import QuickInput from './QuickInput.vue'
import SettingsPanel from './SettingsPanel.vue'
import StaticStage from './StaticStage.vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { useChatStore } from '@/stores/chat'
import { useChimeraTransport } from '@/services/transport/chimera'
import { useLive2DAnimation } from '@/composables/useLive2DAnimation'
import { useWindowDrag } from '@/composables/useWindowDrag'
import { useModelZoom } from '@/composables/useModelZoom'
import { useModelDrag } from '@/composables/useModelDrag'
import { useExpressionState } from '@/composables/useExpressionState'
import { useMotionPriority, MotionLayer } from '@/composables/useMotionPriority'
import { useIdleScheduler, pickIdleGroups } from '@/composables/useIdleScheduler'
import { useLipSync } from '@/composables/useLipSync'
import { useVoiceInput } from '@/composables/useVoiceInput'
import { createPttController } from '@/composables/usePttInput'
import {
  createPixiApp, createLive2DModel, attachLive2DModel, discardLive2DModel, unloadLive2DModel,
  getMotionGroups, describeModel, resizeModel, resizeModelFit, getModelMetrics, RESOLUTION,
  setBaseParameters, setControlLayer, setFocusWeight, focusLive2DModel, setModelLipSync,
  type DeskpetModel, type ModelDiskAssetsInfo,
} from '@/services/live2d/loader'
import { loadImageSet } from '@/services/imageset/loader'
import { discoverModel, clearModelCache, setStoredModelPath, kindOfModelUrl } from '@/services/live2d/model-discovery'
import {
  getAnimationTarget, getEmotionTarget, loadEmotionAdapter,
  resolveModelControlsAndBase, computeControlLayerState, applyControlActionToList,
  findModelStatePreset, resolveModelSliders, resolvePresetMotion,
  normalizePresetSteps, getPresetDefaultFinishMode, isPersistentControlCategory,
  DEFAULT_LIP_SYNC, DESKPET_EMOTIONS, isDeskpetEmotionValue,
  type ModelEmotionAdapter, type ModelStatePreset, type PresetFinishMode, type PresetKeyframeStep,
} from '@/services/live2d/emotion-adapter'
import type { DeskpetControlAction } from '@/services/host/contracts'
import { validateAdapter, reportAdapterValidation } from '@/services/live2d/adapter-validator'

const store = useDeskpetStore()
const chatStore = useChatStore()
const transport = useChimeraTransport()
const { start: startAnim, stop: stopAnim } = useLive2DAnimation()
const { onNavMouseDown } = useWindowDrag()

const stageRef = ref<HTMLDivElement>()
const staticStageRef = ref<{ isCursorOverFigure?: (x: number, y: number) => boolean } | null>(null)
const inputText = ref('')
const showInput = ref(false)
const isHovered = ref(false)
const isModelHovered = ref(false)
const isUiHovered = ref(false)
const chatPanelOpen = ref(false)
const showSettings = ref(false)
const modelError = ref('')

/** 桌宠所在屏幕角落自适应方向：默认右下角（向左弹出 + 底部对齐） */
const popDirectionX = ref<'left' | 'right'>('left')
const alignY = ref<'bottom' | 'top'>('bottom')

function applyWindowPlacement(placement: {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  workAreaX: number
  workAreaY: number
  workAreaWidth: number
  workAreaHeight: number
}) {
  const centerX = placement.windowX + placement.windowWidth / 2
  const centerY = placement.windowY + placement.windowHeight / 2
  const midX = placement.workAreaX + placement.workAreaWidth / 2
  const midY = placement.workAreaY + placement.workAreaHeight / 2
  popDirectionX.value = centerX >= midX ? 'left' : 'right'
  alignY.value = centerY >= midY ? 'bottom' : 'top'
}

/** 伴随浮窗打开时，角色舞台向另一侧平滑偏移，彻底避免浮窗遮挡模型 */
const stageShiftX = computed(() => {
  if (!showSettings.value && !chatPanelOpen.value) return 0
  const shiftMagnitude = Math.round(Math.min(142, window.innerWidth * 0.24))
  return popDirectionX.value === 'left' ? shiftMagnitude : -shiftMagnitude
})

/** 当前模型走哪条渲染路径：Live2D 还是静态立绘包 */
const modelKind = computed(() => (store.modelUrl ? kindOfModelUrl(store.modelUrl) : 'live2d'))

function toggleSettings() {
  if (showSettings.value) {
    showSettings.value = false
  } else {
    chatPanelOpen.value = false
    showSettings.value = true
  }
}

function toggleChatPanel() {
  if (chatPanelOpen.value) {
    chatPanelOpen.value = false
  } else {
    showSettings.value = false
    chatPanelOpen.value = true
  }
}

/** 悬停窗口才显示工具条；但面板开着 / 录音或 VAD 进行中时常驻；锁定穿透开启时完全隐藏不可点击的按钮 */
const controlsVisible = computed(
  () =>
    !store.clickThroughLocked &&
    (isHovered.value || showSettings.value || chatPanelOpen.value || vadActive.value || recordingActive.value),
)

let animFrameId = 0
let unsubscribeGlobalCursor: (() => void) | null = null
let unsubscribeWindowPlacement: (() => void) | null = null
let unsubscribeResetModelView: (() => void) | null = null
let unsubscribeSetHoverFade: (() => void) | null = null
let unsubscribeSetClickThrough: (() => void) | null = null
let unsubscribeScreenshot: (() => void) | null = null
let unsubscribePtt: (() => void) | null = null

/** 当前模型实际拥有的待机 motion 组，模型切换后重新计算 */
let idleGroups: string[] = []
/** 当前模型底层常驻隐藏部件（来自 adapter.hiddenParts） */
let currentBaseHiddenParts: string[] = []
/**
 * 统一的挂载代数：Live2D 与立绘、切换与卸载共用同一个计数器。
 * 之前只有 mountModel 自增，切到立绘或组件卸载时在途加载不会被作废，
 * 旧模型晚到会覆盖当前模式（DP-011）。
 */
let mountSeq = 0
let presetSeqToken = 0
let presetSeqTimer: ReturnType<typeof setTimeout> | null = null
/** 分镜序列播放中或分镜编辑锁定时，未显式指定眼球偏移的步骤保持眼球居中（抑制待机动作随机斜视） */
let sequenceGazeLocked = false

const PRESET_TRANSITION_MS = 380
const REVERT_TRANSITION_MS = 520
const CONTROL_TRANSITION_MS = 320
const RETURN_GAZE_MS = 420

function cancelPresetSequence(): number {
  if (presetSeqTimer) {
    clearTimeout(presetSeqTimer)
    presetSeqTimer = null
  }
  sequenceGazeLocked = false
  return ++presetSeqToken
}

/** 作废所有在途加载：切换、卸载、模式互切都必须先调用 */
function invalidatePendingLoads(): number {
  cancelPresetSequence()
  return ++mountSeq
}

/** 只卸载当前 Live2D 模型，不动 store 里的其它字段 */
function disposeCurrentLive2DModel(): void {
  cancelPresetSequence()
  const previous = store.live2dModel
  if (previous && store.pixiApp) unloadLive2DModel(previous, store.pixiApp)
  store.live2dModel = null
}

function applyModelControlAndSliderLayer(transitionMs = 0): void {
  const model = store.live2dModel
  if (!model) return
  const caps = store.modelCapabilities
  const ctrlLayer = computeControlLayerState(store.modelControls, currentBaseHiddenParts, caps)
  const mergedParams: Record<string, number> = { ...ctrlLayer.parameters }
  const hiddenSet = new Set<string>(ctrlLayer.hiddenParts)
  const shownSet = new Set<string>(ctrlLayer.shownParts)
  let armBSliderModified = false

  for (const s of store.modelSliders) {
    if (Math.abs(s.value - s.defaultValue) > 1e-4) {
      mergedParams[s.id] = s.value
      if (/^Param(Arm|Hand)[LR]B$/i.test(s.id)) {
        armBSliderModified = true
      }
    }
  }

  // 分镜序列播放期间或分镜编辑锁定期间，若当前步骤未显式设定眼球偏移，
  // 也将眼球目标锁定为默认值 0，防止待机动作（如 hiyori_m01）内置的随机斜视曲线干扰演出
  if (sequenceGazeLocked || store.presetEditingLocked) {
    for (const s of store.modelSliders) {
      if (/^(Param)?EyeBall[XY]$/i.test(s.id) && !(s.id in mergedParams)) {
        mergedParams[s.id] = s.defaultValue
      }
    }
  }

  // 若用户在滑条中微调了举手 B 组参数（ParamArmLB/RB、ParamHandLB/RB），自动切出 PartArmB 图层并隐藏 PartArmA
  if (armBSliderModified) {
    const partIds = new Set((caps?.parts ?? []).map((p) => p.id))
    if (partIds.has('PartArmA') && partIds.has('PartArmB')) {
      shownSet.add('PartArmB')
      hiddenSet.delete('PartArmB')
      hiddenSet.add('PartArmA')
      shownSet.delete('PartArmA')
    }
  }

  setControlLayer(
    model,
    {
      parameters: mergedParams,
      hiddenParts: hiddenSet,
      shownParts: shownSet,
    },
    { transitionMs },
  )
}

function reportControlsAndPresetsToHost(): void {
  const caps = store.modelCapabilities
  if (caps) {
    caps.controls = store.modelControls.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      parameters: c.parameters,
      active: c.active,
      source: c.source,
    }))
  }
  transport.sendModelControls(
    store.modelControls.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      active: c.active,
    })),
    store.statePresets.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      emotion: p.emotion,
      group: p.group,
      controls: p.controls,
      parameters: p.parameters,
      custom: true,
    })),
  )
}

function syncControlsToModelAndHost(transitionMs = 0): void {
  applyModelControlAndSliderLayer(transitionMs)
  reportControlsAndPresetsToHost()
}

watch(
  () => store.statePresets,
  () => {
    if (store.modelLoaded) {
      reportControlsAndPresetsToHost()
    }
  },
  { deep: true },
)

watch(showSettings, (open) => {
  if (!open && store.presetEditingLocked) {
    store.presetEditingLocked = false
    if (!presetSeqTimer) {
      sequenceGazeLocked = false
      if (store.live2dModel) {
        setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
      }
      applyModelControlAndSliderLayer(RETURN_GAZE_MS)
    }
  }
})

function applyStepStateToModel(
  step: PresetKeyframeStep,
  transitionMs: number,
  preservePersistentControls = false,
): void {
  const persistentActiveIds = preservePersistentControls
    ? store.modelControls
        .filter((c) => isPersistentControlCategory(c.category) && c.active)
        .map((c) => c.id)
    : []
  for (const c of store.modelControls) {
    c.active = false
  }
  const mergedControls = Array.from(new Set([...persistentActiveIds, ...(step.controls ?? [])]))
  if (mergedControls.length > 0) {
    applyControlActionToList(
      store.modelControls,
      mergedControls,
      'on',
      store.modelCapabilities,
    )
  }

  const stepParams = step.parameters ?? {}
  for (const s of store.modelSliders) {
    const targetVal = stepParams[s.id]
    s.value =
      typeof targetVal === 'number' && Number.isFinite(targetVal) ? targetVal : s.defaultValue
  }

  syncControlsToModelAndHost(transitionMs)
}

function revertToActiveHoldPreset(expectedToken: number): void {
  if (expectedToken !== presetSeqToken || !store.live2dModel) return
  if (store.presetEditingLocked) return
  const holdPreset =
    (store.activeHoldPresetId
      ? store.statePresets.find((p) => p.id === store.activeHoldPresetId)
      : null) ??
    store.statePresets.find((p) => p.id === 'neutral') ??
    null
  store.activeRunningPresetId = holdPreset?.id ?? 'neutral'
  sequenceGazeLocked = false
  setFocusWeight(store.live2dModel, 1, { transitionMs: REVERT_TRANSITION_MS })
  if (holdPreset) {
    const holdSteps = normalizePresetSteps(holdPreset)
    const finalStep = holdSteps[holdSteps.length - 1]
    applyStepStateToModel(finalStep, REVERT_TRANSITION_MS, true)
  } else {
    applyStepStateToModel(
      { durationMs: REVERT_TRANSITION_MS, holdMs: 0, controls: [], parameters: {} },
      REVERT_TRANSITION_MS,
      true,
    )
  }
}

function previewPresetStepOnModel(step: PresetKeyframeStep, gazeOverride = true): void {
  cancelPresetSequence()
  sequenceGazeLocked = gazeOverride
  if (store.live2dModel) {
    setFocusWeight(store.live2dModel, gazeOverride ? 0 : 1, { transitionMs: 220 })
  }
  applyStepStateToModel(step, 240, false)
}

function applyPresetByEntry(
  preset: ModelStatePreset,
  modeOverride?: PresetFinishMode,
): boolean {
  const token = cancelPresetSequence()
  const steps = normalizePresetSteps(preset)
  const finishMode: PresetFinishMode = modeOverride ?? getPresetDefaultFinishMode(preset)

  store.activeRunningPresetId = preset.id ?? preset.label

  const lastStep = steps[steps.length - 1]
  const hasExplicitState =
    steps.length > 1 ||
    lastStep.controls.length > 0 ||
    Object.keys(lastStep.parameters).length > 0

  // 仅当预设显式指定了 motion 对象，或该预设自身不含分镜参数（纯动作型预设）时才调用 .motion3.json，
  // 避免 pixi-live2d-display 的 stopAllMotions() 在分镜切换时强行切断待机曲线造成身体瞬移跳变
  const explicitMotion =
    preset.motion && typeof preset.motion === 'object'
      ? resolvePresetMotion(preset, store.emotionAdapter, store.modelCapabilities)
      : !hasExplicitState
        ? resolvePresetMotion(preset, store.emotionAdapter, store.modelCapabilities)
        : null

  if (explicitMotion) {
    if (store.currentEmotion !== 'neutral') {
      store.currentEmotion = 'neutral'
    }
    playMotionWithPriority(explicitMotion.group, MotionLayer.Reply, explicitMotion.index ?? 0)
    idleScheduler.notifyInteraction()
  } else if (!hasExplicitState && preset.emotion && preset.emotion !== 'neutral') {
    store.currentEmotion = preset.emotion
    store.emotionPulse++
  } else if (store.currentEmotion !== 'neutral') {
    store.currentEmotion = 'neutral'
  }

  // 0ms 零延迟启动：第 1 步分镜插值与鼠标视角跟随权重（focusWeight -> 0）在同一帧时钟同步推进
  sequenceGazeLocked = true
  const firstStepDur = steps[0]?.durationMs ?? PRESET_TRANSITION_MS
  if (store.live2dModel) {
    setFocusWeight(store.live2dModel, 0, { transitionMs: firstStepDur })
  }

  const runStep = (idx: number) => {
    if (token !== presetSeqToken || !store.live2dModel) return
    const step = steps[idx]
    const dur = step.durationMs ?? PRESET_TRANSITION_MS
    const hold = step.holdMs ?? 0
    const isLast = idx >= steps.length - 1

    applyStepStateToModel(step, dur, finishMode === 'revert')

    if (!isLast) {
      presetSeqTimer = setTimeout(() => {
        runStep(idx + 1)
      }, dur + hold)
      return
    }

    presetSeqTimer = setTimeout(() => {
      if (token !== presetSeqToken || !store.live2dModel) return
      if (finishMode === 'loop' && steps.length > 1) {
        runStep(0)
        return
      }

      if (finishMode === 'revert' && !store.presetEditingLocked) {
        const revertDelay = preset.revertHoldMs ?? 1600
        presetSeqTimer = setTimeout(() => {
          revertToActiveHoldPreset(token)
        }, revertDelay)
        return
      }

      // 常驻保持（hold）模式：分镜到位后，若未处于分镜编辑锁定态，平滑恢复鼠标跟随权重
      if (!store.presetEditingLocked) {
        sequenceGazeLocked = false
        setFocusWeight(store.live2dModel, 1, { transitionMs: RETURN_GAZE_MS })
        applyModelControlAndSliderLayer(RETURN_GAZE_MS)
      }
    }, dur + hold)
  }

  runStep(0)

  console.info(
    `[Deskpet] 已触发预设 "${preset.label}" (步数: ${steps.length}, 模式: ${finishMode})`,
  )
  return true
}

function handlePresetTrigger(
  presetOrId: string | ModelStatePreset,
  modeOverride?: PresetFinishMode,
): boolean {
  if (modelKind.value !== 'live2d' || !store.live2dModel) return false
  const preset =
    typeof presetOrId === 'string'
      ? findModelStatePreset(store.statePresets, presetOrId)
      : presetOrId
  if (!preset) return false
  return applyPresetByEntry(preset, modeOverride)
}

function handleControlAction(control: string, action: DeskpetControlAction = 'toggle'): boolean {
  if (modelKind.value !== 'live2d' || !store.live2dModel) {
    console.warn('[Deskpet] 当前不在 Live2D 模式或模型未就绪，无法切换控件')
    return false
  }

  if (action === 'preset') {
    const preset = findModelStatePreset(store.statePresets, control)
    if (!preset) {
      console.warn(`[Deskpet] 未找到组合预设 "${control}"`)
      return false
    }
    return applyPresetByEntry(preset)
  }

  // 当通过 set 传入单个预设名称时，优先匹配已命名的组合预设
  if (action === 'set' && control.trim() && !/[,，;；]/.test(control)) {
    const exactPreset = store.statePresets.find(
      (p) =>
        p.id.toLowerCase() === control.trim().toLowerCase() ||
        p.label.toLowerCase() === control.trim().toLowerCase(),
    )
    if (exactPreset) {
      return applyPresetByEntry(exactPreset)
    }
  }

  // 手动操作单个控件或重置时，取消在途自动回退定时器，确保持久保持用户手动调整的状态
  cancelPresetSequence()
  if (store.presetEditingLocked && store.live2dModel) {
    sequenceGazeLocked = true
    setFocusWeight(store.live2dModel, 0, { transitionMs: 180 })
  }

  if (action === 'reset' || action === 'reset_transient') {
    store.activeHoldPresetId = 'neutral'
    store.activeRunningPresetId = 'neutral'
    for (const s of store.modelSliders) {
      s.value = s.defaultValue
    }
    if (!store.presetEditingLocked && store.live2dModel) {
      sequenceGazeLocked = false
      setFocusWeight(store.live2dModel, 1, { transitionMs: CONTROL_TRANSITION_MS })
    }
  }

  const { matched, matchedList, changed } = applyControlActionToList(
    store.modelControls,
    control,
    action,
    store.modelCapabilities,
  )
  const isBatchOrReset = action === 'reset' || action === 'reset_transient' || action === 'set'
  if (!isBatchOrReset && !matched) {
    const fallbackPreset = findModelStatePreset(store.statePresets, control)
    if (fallbackPreset) {
      return applyPresetByEntry(fallbackPreset)
    }
    const available = store.modelControls.map((c) => c.id)
    console.warn(
      `[Deskpet] 未找到控件 "${control}"` +
        (available.length ? `，可用控件：${available.join(', ')}` : '（该模型没有可用控件）'),
    )
    return false
  }
  syncControlsToModelAndHost(CONTROL_TRANSITION_MS)
  if (action === 'reset') {
    console.info('[Deskpet] 已重置所有模型控件与面捕滑块为默认状态')
  } else if (action === 'reset_transient') {
    console.info('[Deskpet] 已重置临时动作、表情控件与面捕滑块（常驻外观保留）')
  } else if (action === 'set') {
    console.info(
      `[Deskpet] 已组合切换状态控件 (${matchedList.length} 项):`,
      matchedList.map((m) => m.label).join(', ') || '日常待机',
    )
  } else if (matched) {
    console.info(`[Deskpet] 控件 "${matched.label}" → ${matched.active ? 'ON' : 'OFF'}`)
  }
  return changed || isBatchOrReset
}

store.registerControlHandler(handleControlAction)
store.registerSliderSyncHandler((transitionMs = 0) => {
  cancelPresetSequence()
  if (store.presetEditingLocked && store.live2dModel) {
    sequenceGazeLocked = true
    setFocusWeight(store.live2dModel, 0, { transitionMs: 180 })
  }
  applyModelControlAndSliderLayer(transitionMs)
})
store.registerPresetTriggerHandler(handlePresetTrigger)
store.registerStepPreviewHandler(previewPresetStepOnModel)

/** 提交阶段：模型已经准备好且代数有效，才写入 store、校验适配并启动动画 */
function commitLive2DModel(
  url: string,
  model: DeskpetModel,
  adapter: ModelEmotionAdapter,
  diskAssets: ModelDiskAssetsInfo | null,
): void {
  attachLive2DModel(model, store.pixiApp!)

  // 汇总模型真实能力 + 磁盘资产（.cdi3.json / .physics3.json / .vtube.json / .exp3.json）
  const capabilities = describeModel(model, url, diskAssets)
  const resolved = resolveModelControlsAndBase(adapter, capabilities, diskAssets)
  const sliders = resolveModelSliders(capabilities, resolved.controls, resolved.baseParameters)
  currentBaseHiddenParts = resolved.hiddenParts
  capabilities.baseParameters = resolved.baseParameters
  capabilities.controls = resolved.controls.map((c) => ({
    id: c.id,
    label: c.label,
    category: c.category,
    parameters: c.parameters,
    active: c.active,
    source: c.source,
  }))

  store.emotionAdapter = adapter
  store.modelCapabilities = capabilities
  // adapter 声明的情绪键（含自定义）登记到 store，随连接上报给插件
  store.modelEmotions = Object.keys(adapter.emotions)
  store.modelControls = resolved.controls
  store.modelSliders = sliders
  // Live2D 的情绪回退目标固定为 neutral（立绘包则由清单标定）
  store.defaultEmotion = 'neutral'
  resizeModel(model, window.innerWidth, window.innerHeight, store.modelZoom)
  model.position.x += store.modelOffsetX
  model.position.y += store.modelOffsetY
  store.live2dModel = model
  store.modelUrl = url
  store.ensureModelPresetsSeeded(diskAssets?.savedPresets ?? null)
  store.modelLoaded = true

  // 1) 应用底层常驻参数（如自动去除作者水印）
  setBaseParameters(model, resolved.baseParameters)
  if (Object.keys(resolved.baseParameters).length > 0) {
    console.info('[Deskpet] 已应用底层常驻/去水印参数:', resolved.baseParameters)
  }
  // 2) 应用控件层（含默认开启的控件与隐藏部件）并同步给后端
  syncControlsToModelAndHost()
  if (resolved.controls.length > 0) {
    console.info(
      `[Deskpet] 已发现模型控件 ${resolved.controls.length} 个:`,
      resolved.controls.map((c) => c.label).join(', '),
    )
  }
  // 3) 立即应用初始 neutral 情绪，避免首次加载漏掉 neutral 参数
  store.currentEmotion = 'neutral'
  store.emotionPulse++

  // 对着模型真实能力核一遍 adapter，把静默失效变成明确报错
  if (adapter.loaded) {
    reportAdapterValidation(
      validateAdapter(adapter, capabilities),
      capabilities,
      adapter.name || adapter.modelId || url,
    )
  }

  // adapter 声明的待机组优先；没声明就按组名猜
  const declaredIdle = adapter.idleMotions.filter((group) => group in capabilities.motionGroups)
  idleGroups = declaredIdle.length > 0 ? declaredIdle : pickIdleGroups(getMotionGroups(model))
  if (idleGroups.length === 0) {
    console.info('[Deskpet] Model has no idle motion group, idle animation disabled')
  }
  startAnim(model)
  idleScheduler.start()
}

/** 初次挂载：只用于组件启动，与热切换共用同一套代数与提交逻辑 */
async function mountModel(url: string): Promise<void> {
  const seq = invalidatePendingLoads()
  const [model, adapter, diskAssets] = await Promise.all([
    createLive2DModel(url),
    loadEmotionAdapter(url),
    window.electronAPI?.inspectModelAssets?.(url).catch(() => null) ?? Promise.resolve(null),
  ])
  if (seq !== mountSeq) {
    // 加载期间又发起了新的挂载/切换：丢弃这只模型，避免双模型同台 + 纹理泄漏
    discardLive2DModel(model)
    return
  }
  commitLive2DModel(url, model, adapter, diskAssets)
}

/** Pixi 应用只在 Live2D 路径需要；立绘模式下首次切回 Live2D 时按需创建 */
async function ensurePixiApp(): Promise<boolean> {
  if (store.pixiApp) return true
  if (typeof (window as any).Live2DCubismCore === 'undefined') {
    modelError.value = '缺少 Cubism 4 运行时'
    return false
  }
  try {
    const app = await createPixiApp(stageRef.value!, window.innerWidth, window.innerHeight)
    store.pixiApp = app
    const canvas = app.view as HTMLCanvasElement
    canvas.addEventListener('wheel', onWheel as any, { passive: false } as any)
    return true
  } catch (err) {
    console.error('[Deskpet] Failed to create PixiJS app:', err)
    modelError.value = `渲染初始化失败: ${err}`
    return false
  }
}

/**
 * 设置面板里换模型：先准备新模型，成功后才卸旧模型。
 * 新模型加载失败时保留当前角色（DP-010），不再出现"旧的已卸、新的没装上"。
 */
async function switchModel(url: string): Promise<void> {
  if (url === store.modelUrl) return
  const kind = kindOfModelUrl(url)
  const seq = invalidatePendingLoads()
  const previousUrl = store.modelUrl

  if (kind === 'image-set') {
    // 先验证清单：失败就保留当前角色，不进入半吊子状态
    try {
      await loadImageSet(url)
    } catch (err) {
      if (seq === mountSeq) {
        console.error('[Deskpet] Failed to switch to image-set:', err)
        modelError.value = `立绘包加载失败: ${err}`
      }
      return
    }
    if (seq !== mountSeq) return

    idleScheduler.stop()
    stopAnim()
    resetMotionPriority()
    disposeCurrentLive2DModel()
    currentBaseHiddenParts = []
    store.emotionAdapter = null
    store.modelCapabilities = null
    store.modelEmotions = []
    store.modelControls = []
    transport.sendModelControls([])
    store.defaultEmotion = 'neutral'
    store.modelLoaded = false
    clearModelCache()
    // StaticStage 监听 modelUrl 接管立绘包真正的加载与提交
    store.modelUrl = url
    setStoredModelPath(url)
    modelError.value = ''
    console.log(`[Deskpet] Switched to image-set: ${previousUrl || '(none)'} → ${url}`)
    return
  }

  if (!(await ensurePixiApp())) return
  if (seq !== mountSeq) return

  let model: DeskpetModel
  let adapter: ModelEmotionAdapter
  let diskAssets: ModelDiskAssetsInfo | null = null
  try {
    ;[model, adapter, diskAssets] = await Promise.all([
      createLive2DModel(url),
      loadEmotionAdapter(url),
      window.electronAPI?.inspectModelAssets?.(url).catch(() => null) ?? Promise.resolve(null),
    ])
  } catch (err) {
    if (seq === mountSeq) {
      console.error('[Deskpet] Failed to switch model:', err)
      modelError.value = `模型加载失败: ${err}`
    }
    return
  }
  if (seq !== mountSeq) {
    discardLive2DModel(model)
    return
  }

  // 提交阶段：此刻才停旧动画、卸旧模型
  idleScheduler.stop()
  stopAnim()
  resetMotionPriority()
  disposeCurrentLive2DModel()
  clearModelCache()
  commitLive2DModel(url, model, adapter, diskAssets)
  setStoredModelPath(url)
  modelError.value = ''
  console.log(`[Deskpet] Switched model: ${previousUrl || '(none)'} → ${url}`)
}

store.registerModelSwitcher(switchModel)

/**
 * 开发者工具里可直接调用的适配与控件调试助手：
 *   deskpetInspectModel()              导出模型能力清单（含控件与去水印参数）
 *   deskpetListControls()              查看当前模型所有可用控件及开关状态
 *   deskpetTestControl('帽子', 'toggle') 切换/开启/关闭/重置某个模型控件
 *   deskpetTestEmotion('happy')        预览某个情绪的适配效果
 *   deskpetTestAnimation('wave')       预览某个语义动作的适配效果
 */
function installModelInspector() {
  ;(window as any).deskpetInspectModel = () => {
    const caps = store.modelCapabilities
    if (!caps) {
      console.warn('[Deskpet] 模型还没加载完')
      return null
    }
    console.log(JSON.stringify(caps, null, 2))
    console.info(
      `[Deskpet] 动作组 ${Object.keys(caps.motionGroups).length} 个、` +
        `表情 ${caps.expressions.length} 个、参数 ${caps.parameters.length} 个、` +
        `控件 ${caps.controls?.length ?? 0} 个。` +
        '适配规范见 docs/MODEL-ADAPTER-SPEC.md',
    )
    return caps
  }

  ;(window as any).deskpetListControls = () => {
    const list = store.modelControls.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      active: c.active,
      source: c.source,
    }))
    console.table(list)
    return list
  }

  ;(window as any).deskpetTestControl = (
    control: string,
    action: DeskpetControlAction = 'toggle',
  ) => {
    return store.applyControlAction(control, action)
  }

  ;(window as any).deskpetTestEmotion = (emotion: string) => {
    // 立绘模式按清单键检查；Live2D 支持内置词表 + adapter 自定义情绪
    if (modelKind.value === 'image-set') {
      if (!store.modelEmotions.includes(emotion)) {
        console.warn(`[Deskpet] 立绘包里没有 "${emotion}"，可用：${store.modelEmotions.join(', ')}`)
        return
      }
    } else {
      if (!isDeskpetEmotionValue(emotion) && !store.modelEmotions.includes(emotion)) {
        const available = [...new Set([...DESKPET_EMOTIONS, ...store.modelEmotions])]
        console.warn(`[Deskpet] 未知情绪 "${emotion}"，可用：${available.join(', ')}`)
        return
      }
      if (!getEmotionTarget(store.emotionAdapter, emotion)) {
        console.warn(`[Deskpet] adapter 里没有映射情绪 "${emotion}"，不会有任何效果`)
        return
      }
    }
    store.currentEmotion = emotion
    store.emotionPulse++
    console.info(`[Deskpet] 测试情绪：${emotion}（6 秒后自动回默认表情）`)
  }

  ;(window as any).deskpetTestAnimation = (name: string) => {
    const target = getAnimationTarget(store.emotionAdapter, name)
    if (!target) {
      const available = Object.keys(store.emotionAdapter?.animations ?? {})
      console.warn(
        `[Deskpet] adapter 里没有映射动作 "${name}"` +
          (available.length ? `，已映射的动作：${available.join(', ')}` : '（该 adapter 未映射任何动作）'),
      )
      return
    }
    store.pendingAnimation = name
    console.info(`[Deskpet] 测试动作：${name} → 组 "${target.motion.group}" #${target.motion.index ?? 0}`)
  }
}

onMounted(async () => {
  const container = stageRef.value
  if (!container) return

  // clear any leftover canvas from HMR reloads
  container.innerHTML = ''

  // prevent duplicate model loads
  if (store.modelLoaded) {
    console.log('[Deskpet] Model already loaded, skipping')
    return
  }

  installModelInspector()

  const modelUrl = await discoverModel()
  if (!modelUrl) {
    // 不 return：用户放入模型后点「重新扫描」再切换仍然可用
    modelError.value = '未找到模型文件，请将 Live2D 模型或立绘包放入 public/models/ 目录'
  } else if (kindOfModelUrl(modelUrl) === 'image-set') {
    // 静态立绘包：不需要 Pixi/Cubism，StaticStage 监听 modelUrl 自行加载，成功后才置 modelLoaded
    store.modelUrl = modelUrl
    console.log('[Deskpet] 静态立绘模式:', modelUrl)
  } else {
    // Pixi 应用、滚轮缩放先就位再谈模型 ——
    // 否则「models 目录为空 / 首个模型损坏」会把之后的切换功能一并打坏
    if (await ensurePixiApp()) {
      try {
        await mountModel(modelUrl)
        console.log('[Deskpet] Live2D model loaded successfully')
      } catch (err) {
        console.error('[Deskpet] Failed to load Live2D model:', err)
        modelError.value = `模型加载失败: ${err}`
      }
    }
  }

  window.addEventListener('blur', onWindowBlur)
  unsubscribeGlobalCursor = window.electronAPI?.onGlobalCursorPosition?.((position) => {
    mouseX = position.x
    mouseY = position.y
    if (
      position.x < 0 ||
      position.x > window.innerWidth ||
      position.y < 0 ||
      position.y > window.innerHeight
    ) {
      isHovered.value = false
      isModelHovered.value = false
      isUiHovered.value = false
    } else {
      updateModelHover(position.x, position.y)
    }
  }) ?? null
  unsubscribeWindowPlacement = window.electronAPI?.onWindowPlacement?.((placement) => {
    applyWindowPlacement(placement)
  }) ?? null
  void window.electronAPI?.getWindowPlacement?.().then((placement) => {
    if (placement) applyWindowPlacement(placement)
  }).catch(() => {})
  unsubscribeResetModelView = window.electronAPI?.onResetModelView?.(() => {
    resetModelView()
  }) ?? null
  unsubscribeSetHoverFade = window.electronAPI?.onSetHoverFade?.((enabled) => {
    store.hoverFadeEnabled = enabled
  }) ?? null
  unsubscribeSetClickThrough = window.electronAPI?.onSetClickThroughLocked?.((locked) => {
    store.clickThroughLocked = locked
    if (locked) {
      showSettings.value = false
      chatPanelOpen.value = false
      showInput.value = false
    }
  }) ?? null
  unsubscribeScreenshot = window.electronAPI?.onScreenshotCaptured?.((base64) => {
    transport.sendScreenshot(base64)
  }) ?? null
  unsubscribePtt = window.electronAPI?.onPttEvent?.((state) => {
    if (state === 'down') void onPttDown()
    else if (state === 'up') void onPttUp()
    else onPttCancel()
  }) ?? null

  startAnimationPoll()
})

watch(() => [store.currentEmotion, store.emotionPulse] as const, ([emotion]) => {
  if (!store.live2dModel || emotion === 'neutral' || emotion === 'idle') return
  const target = getEmotionTarget(store.emotionAdapter, emotion)
  if (target?.motion) {
    playMotionWithPriority(target.motion.group, MotionLayer.Reply, target.motion.index ?? 0)
    idleScheduler.notifyInteraction()
  }
})

// 模型声明的情绪键（含自定义）变化时上报插件，set_deskpet_emotion 才能用这些键
watch(
  () => store.modelEmotions,
  (emotions) => {
    transport.sendModelEmotions([...emotions])
  },
  { deep: true },
)

let lastW = window.innerWidth
let lastH = window.innerHeight
let lastZoom = store.modelZoom
let mouseX = window.innerWidth / 2
let mouseY = window.innerHeight / 2

const { onWheel } = useModelZoom(
  store,
  () => ({ x: mouseX - stageShiftX.value, y: mouseY }),
  () => ({ width: window.innerWidth, height: window.innerHeight }),
  (zoom) => { lastZoom = zoom },
)
const { onModelMouseDown, consumeDragOffsets, isDragging } = useModelDrag()

function isCursorOverLive2dModel(canvasCssX: number, canvasCssY: number): boolean {
  const m = store.live2dModel
  if (!m || !store.modelLoaded) return false

  let minX = NaN
  let maxX = NaN
  let minY = NaN
  let maxY = NaN
  try {
    const bounds = m.getBounds()
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      minX = bounds.x / RESOLUTION
      maxX = (bounds.x + bounds.width) / RESOLUTION
      minY = bounds.y / RESOLUTION
      maxY = (bounds.y + bounds.height) / RESOLUTION
    }
  } catch {
    // 降级由 metrics 计算
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    const metrics = getModelMetrics(m)
    const halfW = (metrics.refW * m.scale.x) / 2
    const halfH = (metrics.refH * m.scale.y) / 2
    minX = m.position.x - halfW
    maxX = m.position.x + halfW
    minY = m.position.y - halfH
    maxY = m.position.y + halfH
  }

  return canvasCssX >= minX && canvasCssX <= maxX && canvasCssY >= minY && canvasCssY <= maxY
}

function updateModelHover(clientX: number, clientY: number): void {
  if (
    clientX < 0 ||
    clientX > window.innerWidth ||
    clientY < 0 ||
    clientY > window.innerHeight
  ) {
    isHovered.value = false
    isModelHovered.value = false
    isUiHovered.value = false
    return
  }

  isHovered.value = true

  if (modelKind.value === 'live2d') {
    const localX = clientX - stageShiftX.value
    const localY = clientY
    isModelHovered.value = isCursorOverLive2dModel(localX, localY)
  } else if (modelKind.value === 'image-set') {
    isModelHovered.value = staticStageRef.value?.isCursorOverFigure?.(clientX, clientY) ?? false
  } else {
    isModelHovered.value = false
  }
}

const shouldFadeModel = computed(() => {
  if (!store.hoverFadeEnabled) return false
  if (showSettings.value || chatPanelOpen.value || showInput.value) return false
  if (isUiHovered.value || isDragging.value) return false
  return isModelHovered.value
})

function onMouseLeave() {
  isHovered.value = false
  isModelHovered.value = false
  isUiHovered.value = false
}

function onWindowBlur() {
  isHovered.value = false
  isModelHovered.value = false
  isUiHovered.value = false
}
const { cleanup: cleanupExpression } = useExpressionState(store)
const { playMotionWithPriority, reset: resetMotionPriority } = useMotionPriority(store)
const idleScheduler = useIdleScheduler(playMotionWithPriority, () => idleGroups)
const { getMouthOpen } = useLipSync()
const {
  start: startRecord, stop: stopRecord, createRecordingChannel,
  recordingActive, vadActive,
  enableVad, disableVad, cleanup: cleanupVoice,
} = useVoiceInput({
  onError: (msg) => chatStore.showChatMessage(msg),
})

const micTitle = computed(() => {
  if (vadActive.value) return 'VAD 监听中，点击关闭（右键单次手动录音需先关闭 VAD）'
  if (recordingActive.value) return '录音中，右键结束并发送'
  return '点击开启语音监听（VAD）／右键单次手动录音'
})

function sendVoiceText(text: string) {
  chatStore.addUserMessage(text)
  if (!transport.sendUserText(text)) {
    chatStore.showChatMessage('（未连接到 MaiBot，这条消息没有发出去）')
  }
}

async function toggleVad() {
  if (vadActive.value) {
    disableVad()
    return
  }
  try {
    await enableVad(sendVoiceText)
  } catch {
    chatStore.showChatMessage('（无法启动麦克风，请检查录音设备或权限）')
  }
}

/** 右键：单次手动录音，适合 VAD 误判多的嘈杂环境 */
async function toggleManualRecording() {
  if (vadActive.value) return
  if (recordingActive.value) {
    const text = await stopRecord()
    if (text) sendVoiceText(text)
    return
  }
  try {
    await startRecord()
  } catch (err) {
    console.warn('[Deskpet] Failed to start recording:', err)
    chatStore.showChatMessage('（无法启动麦克风，请检查录音设备或权限）')
  }
}

// ── 全局 PTT 热键（hotkey-bridge 经主进程转发 ptt-event）──

/** 热键模式：ptt = 按住说话松开发送；toggle = 按一下开/再按一下关 */
function getPttMode(): 'ptt' | 'toggle' {
  try {
    return localStorage.getItem('deskpet/ptt-mode') === 'toggle' ? 'toggle' : 'ptt'
  } catch {
    return 'ptt'
  }
}

const pttRecording = createRecordingChannel()
const { onDown: onPttDown, onUp: onPttUp, cancel: onPttCancel } = createPttController({
  start: pttRecording.start,
  stop: pttRecording.stop,
  cancel: pttRecording.cancel,
  hasCapture: pttRecording.hasCapture,
  isRecording: () => recordingActive.value,
  isVadEnabled: () => vadActive.value,
  getMode: getPttMode,
  onText: sendVoiceText,
  onError: (err) => {
    console.warn('[Deskpet] PTT recording failed:', err)
    chatStore.showChatMessage('（无法启动麦克风，请检查录音设备或权限）')
  },
})

function startAnimationPoll() {
  let lastFocusModel: DeskpetModel | null = null
  let lastFocusX = NaN
  let lastFocusY = NaN
  let lastModelPosX = NaN
  let lastModelPosY = NaN
  let lastModelScale = NaN
  let lastMouthVal = 0

  const tick = () => {
    // 只在角色就绪时消费：热切换空窗期把指令吃掉会静默丢失动作
    if (store.modelLoaded && store.pendingAnimation) {
      const pending = store.consumePendingAnimation()!
      const target = store.live2dModel ? getAnimationTarget(store.emotionAdapter, pending.name) : null
      if (target?.motion) {
        playMotionWithPriority(
          target.motion.group, MotionLayer.Reply, target.motion.index ?? 0, { loop: pending.loop },
        )
        idleScheduler.notifyInteraction()
      } else {
        // 立绘包没有动作能力，或 adapter 未映射该动作：明确记录，不虚报成功
        console.debug(`[Deskpet] Animation unsupported or unmapped: ${pending.name}`)
      }
    }
    if (store.live2dModel) {
      const m = store.live2dModel
      const cw = window.innerWidth
      const ch = window.innerHeight
      if (Math.abs(cw - lastW) > 2 || Math.abs(ch - lastH) > 2) {
        store.pixiApp!.renderer.resize(cw * RESOLUTION, ch * RESOLUTION)
        store.pixiApp!.stage.scale.set(RESOLUTION)
        lastW = cw
        lastH = ch
        resizeModelFit(m, cw, ch, store.modelZoom)
        m.position.x += store.modelOffsetX
        m.position.y += store.modelOffsetY
      }
      if (store.modelZoom !== lastZoom) {
        lastZoom = store.modelZoom
        // zoom focal point is handled in onWheel, not here
        resizeModel(m, cw, ch, store.modelZoom)
      }
      const dragOffsets = consumeDragOffsets()
      if (dragOffsets) {
        m.position.x += dragOffsets.x
        m.position.y += dragOffsets.y
        // clamp: keep at least 20% of model visible
        const { refW, refH } = getModelMetrics(m)
        const vw = refW * m.scale.x
        const vh = refH * m.scale.y
        m.position.x = Math.max(-vw * 0.8, Math.min(cw + vw * 0.8, m.position.x))
        m.position.y = Math.max(-vh * 0.8, Math.min(ch + vh * 0.8, m.position.y))
        store.setModelOffset(m.position.x - cw / 2, m.position.y - ch / 2)
      }
      // 仅当光标、伴随舞台偏移或模型变换发生变化时才重新计算目标视线，省去静止帧的矩阵求逆开销
      const targetCanvasX = (mouseX - stageShiftX.value) * RESOLUTION
      const targetCanvasY = mouseY * RESOLUTION
      if (
        m !== lastFocusModel ||
        targetCanvasX !== lastFocusX ||
        targetCanvasY !== lastFocusY ||
        m.position.x !== lastModelPosX ||
        m.position.y !== lastModelPosY ||
        m.scale.x !== lastModelScale
      ) {
        lastFocusModel = m
        lastFocusX = targetCanvasX
        lastFocusY = targetCanvasY
        lastModelPosX = m.position.x
        lastModelPosY = m.position.y
        lastModelScale = m.scale.x
        try {
          focusLive2DModel(m, targetCanvasX, targetCanvasY, false)
        } catch {
          /* focus not supported */
        }
      }
      // 张嘴参数由 adapter 声明，经 setModelLipSync 挂入 beforeModelUpdate 管线；未说话且已闭合归零时跳过每帧写入
      const rawMouth = getMouthOpen()
      const speakingActive = store.isSpeaking || rawMouth > 0
      if (speakingActive || lastMouthVal > 0) {
        lastMouthVal = speakingActive ? Math.max(rawMouth, 1e-4) : 0
        const lipSync = store.emotionAdapter?.lipSync
        setModelLipSync(
          m,
          lipSync?.mouthOpenParam ?? DEFAULT_LIP_SYNC.mouthOpenParam,
          rawMouth * (lipSync?.gain ?? DEFAULT_LIP_SYNC.gain),
          speakingActive,
        )
      }
    }
    if (isHovered.value) {
      updateModelHover(mouseX, mouseY)
    }
    animFrameId = requestAnimationFrame(tick)
  }
  animFrameId = requestAnimationFrame(tick)
}

function onMouseMove(e: MouseEvent) {
  mouseX = e.clientX
  mouseY = e.clientY
  updateModelHover(e.clientX, e.clientY)
}

window.addEventListener('mousemove', onMouseMove)
onUnmounted(() => {
  invalidatePendingLoads()
  stopAnim()
  if (animFrameId) cancelAnimationFrame(animFrameId)
  unsubscribeGlobalCursor?.()
  unsubscribeGlobalCursor = null
  unsubscribeWindowPlacement?.()
  unsubscribeWindowPlacement = null
  unsubscribeResetModelView?.()
  unsubscribeResetModelView = null
  unsubscribeSetHoverFade?.()
  unsubscribeSetHoverFade = null
  unsubscribeSetClickThrough?.()
  unsubscribeSetClickThrough = null
  unsubscribeScreenshot?.()
  unsubscribeScreenshot = null
  unsubscribePtt?.()
  unsubscribePtt = null
  cleanupExpression()
  onPttCancel()
  cleanupVoice()
  idleScheduler.stop()
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('mousemove', onMouseMove)
  if (store.pixiApp) {
    const canvas = store.pixiApp.view as HTMLCanvasElement
    canvas.removeEventListener('wheel', onWheel as any)
    store.pixiApp.destroy(true, { children: true, texture: true })
    store.pixiApp = null
  }
  store.live2dModel = null
  store.emotionAdapter = null
  store.modelCapabilities = null
  store.modelControls = []
  store.modelSliders = []
  store.modelLoaded = false
  store.modelUrl = ''
  delete (window as any).deskpetInspectModel
  delete (window as any).deskpetListControls
  delete (window as any).deskpetTestControl
  delete (window as any).deskpetTestEmotion
  delete (window as any).deskpetTestAnimation
})

function onDoubleClick() {
  showInput.value = true
}

/** 右键：循环切换当前模型的情绪（跳过默认/常态；6 秒后自动回默认表情） */
function onStageRightClick() {
  const pool = store.modelEmotions.filter(
    (e) => e !== store.defaultEmotion && e !== 'neutral' && e !== 'idle',
  )
  if (pool.length === 0) return
  const idx = pool.indexOf(store.currentEmotion)
  const next = pool[(idx + 1) % pool.length]
  store.currentEmotion = next
  store.emotionPulse++
}

function sendText() {
  const text = inputText.value.trim()
  if (!text) return
  chatStore.addUserMessage(text)
  if (!transport.sendUserText(text)) {
    chatStore.showChatMessage('（未连接到 MaiBot，这条消息没有发出去）')
  }
  inputText.value = ''
  showInput.value = false
}

function resetModelView() {
  store.resetModelView()
  if (store.live2dModel) {
    resizeModelFit(store.live2dModel, window.innerWidth, window.innerHeight, store.modelZoom)
    lastZoom = store.modelZoom
  }
}
</script>

<style scoped>
.deskpet-stage {
  width: 100vw;
  height: 100vh;
  position: relative;
  -webkit-app-region: no-drag;
  user-select: none;
  overflow: hidden;
  border-radius: 28px;
}

.deskpet-stage::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 28px;
  pointer-events: none;
  z-index: 30;
  opacity: 0;
  transition: opacity 0.25s ease;
  box-shadow:
    inset 0 0 40px 20px rgba(60, 60, 60, 0.25),
    inset 0 0 80px 40px rgba(60, 60, 60, 0.15),
    inset 0 0 140px 70px rgba(60, 60, 60, 0.06);
}

.deskpet-stage:not(.click-through-locked).hovered::after {
  opacity: 1;
}

/* 角色层：伴随浮窗打开时平滑横移，留出零遮挡空间 */
.stage-actor-layer {
  width: 100%;
  height: 100%;
  transform: translate3d(var(--stage-shift-x, 0px), 0, 0);
  transition: transform 0.56s var(--spring-gentle);
  will-change: transform;
}

.live2d-stage {
  width: 100%;
  height: 100%;
  display: block;
  transition: opacity 0.18s ease;
}

.deskpet-stage.hover-fade-enabled.model-faded .live2d-stage {
  opacity: 0.15;
}

.nav-bar {
  position: absolute;
  bottom: 4px;
  left: calc(50% + var(--stage-shift-x, 0px));
  transform: translateX(-50%);
  width: 160px;
  height: 32px;
  -webkit-app-region: no-drag;
  z-index: 50;
  cursor: move;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: left 0.56s var(--spring-gentle), opacity 0.22s ease;
}

.deskpet-stage:not(.click-through-locked).hovered .nav-bar {
  opacity: 1;
  pointer-events: auto;
}

.nav-bar::after {
  content: '';
  width: 140px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.5);
}

/* ── 边缘竖排伴随工具条：随角落方位吸附在窗口外侧边缘 ── */
.btn-bar {
  position: absolute;
  bottom: 44px;
  z-index: 65;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border-radius: 14px;
  background: var(--dp-panel-bg, var(--dp-dock-bg));
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.18s ease,
    background 0.22s ease,
    border-color 0.22s ease;
}

/* 桌宠靠屏幕右半边（pop-left）：停靠条在右侧边缘，浮窗向左弹出 */
.btn-bar.dock-left {
  right: 12px;
}

/* 桌宠靠屏幕左半边（pop-right）：停靠条在左侧边缘，浮窗向右弹出 */
.btn-bar.dock-right {
  left: 12px;
}

.btn-bar.visible {
  opacity: 1;
  pointer-events: auto;
}

.btn-bar-item {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  padding: 0;
  color: var(--dp-icon);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    border-color 0.16s ease;
  user-select: none;
}

.btn-bar-item:hover {
  background: var(--dp-card-hover);
  color: var(--dp-text-main);
}

.btn-bar-item.active {
  background: var(--dp-accent-soft);
  border-color: var(--dp-accent-border);
  color: var(--dp-text-main);
}

.btn-bar-item svg {
  width: 17px;
  height: 17px;
  stroke: currentColor;
  stroke-width: 2;
}

.btn-bar-item.recording {
  background: rgba(239, 68, 68, 0.24);
  color: #f87171;
  animation: mic-pulse 1s ease-in-out infinite;
}

.btn-bar-item.vad {
  background: rgba(52, 211, 153, 0.2);
  color: #34d399;
}

@keyframes mic-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.35); }
  50% { box-shadow: 0 0 0 7px rgba(248, 113, 113, 0); }
}

.model-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: var(--dp-text-primary);
  background: var(--dp-panel-bg, var(--dp-bg));
  border: 1px solid var(--dp-border);
  padding: 36px;
  border-radius: 18px;
  max-width: 340px;
  -webkit-app-region: no-drag;
}
.model-error p {
  font-size: 14px;
  margin: 8px 0;
  line-height: 1.6;
}
.model-error .error-icon {
  font-size: 36px;
  font-weight: 700;
  margin-bottom: 10px;
  color: var(--dp-accent);
}
.model-error .error-hint {
  font-size: 12px;
  color: var(--dp-text-secondary);
}
.model-error code {
  background: var(--dp-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}
</style>

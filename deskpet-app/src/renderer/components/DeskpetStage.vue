<template>
  <div class="deskpet-stage" :class="{ hovered: isHovered, 'hover-fade-enabled': store.hoverFadeEnabled }" @dblclick="onDoubleClick" @mousedown.left="onModelMouseDown" @mouseenter="isHovered = true" @mouseleave="isHovered = false">
    <div ref="stageRef" class="live2d-stage" />
    <div class="nav-bar" title="拖动窗口，双击重置模型位置和缩放" @mousedown.stop="onNavMouseDown" @dblclick.stop="resetModelView" />

    <!-- bottom-right button bar -->
    <div class="btn-bar" :class="{ shifted: chatPanelOpen }">
      <div class="btn-bar-item" @mousedown.stop @click.stop="showSettings = true" title="设置">⚙</div>
      <div class="btn-bar-item" @mousedown.stop @click.stop="chatPanelOpen = !chatPanelOpen" :title="chatPanelOpen ? '收起聊天' : '聊天记录'">💬</div>
      <div
        class="btn-bar-item"
        :class="{ recording: recordingActive, vad: vadActive }"
        @mousedown.stop
        @click.stop="toggleVad"
        @contextmenu.prevent.stop="toggleManualRecording"
        :title="micTitle"
      >🎤</div>
    </div>

    <SettingsPanel :open="showSettings" @close="showSettings = false" />

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
      @bubbles-cleared="showInput = false; inputText = ''"
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
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import ChatBubble from './ChatBubble.vue'
import QuickInput from './QuickInput.vue'
import SettingsPanel from './SettingsPanel.vue'
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
import {
  createPixiApp, loadLive2DModel, unloadLive2DModel, getMotionGroups, describeModel,
  resizeModel, resizeModelFit, modelRefW, modelRefH, RESOLUTION,
} from '@/services/live2d/loader'
import { discoverModel, clearModelCache, setStoredModelPath } from '@/services/live2d/model-discovery'
import {
  getAnimationTarget, getEmotionTarget, loadEmotionAdapter,
  DEFAULT_LIP_SYNC, DESKPET_EMOTIONS, isDeskpetEmotionValue,
} from '@/services/live2d/emotion-adapter'
import { validateAdapter, reportAdapterValidation } from '@/services/live2d/adapter-validator'

const store = useDeskpetStore()
const chatStore = useChatStore()
const transport = useChimeraTransport()
const { start: startAnim, stop: stopAnim } = useLive2DAnimation()
const { onNavMouseDown } = useWindowDrag()

const stageRef = ref<HTMLDivElement>()
const inputText = ref('')
const showInput = ref(false)
const isHovered = ref(false)
const chatPanelOpen = ref(false)
const showSettings = ref(false)
const modelError = ref('')

let animFrameId = 0
let unsubscribeGlobalCursor: (() => void) | null = null
let unsubscribeResetModelView: (() => void) | null = null
let unsubscribeSetHoverFade: (() => void) | null = null
let unsubscribeScreenshot: (() => void) | null = null

/** 当前模型实际拥有的待机 motion 组，模型切换后重新计算 */
let idleGroups: string[] = []
/** 挂载代数：初始挂载还没完成时用户就切换模型会并发两个 mountModel，只让最后一次生效 */
let mountSeq = 0

async function mountModel(url: string): Promise<void> {
  const app = store.pixiApp
  if (!app) throw new Error('PixiJS application not ready')
  const seq = ++mountSeq

  const model = await loadLive2DModel(url, app)
  const adapter = await loadEmotionAdapter(url)
  if (seq !== mountSeq) {
    // 加载期间又发起了新的挂载：这只模型已过时，卸掉避免双模型同台 + 纹理泄漏
    unloadLive2DModel(model, app)
    return
  }
  store.emotionAdapter = adapter
  resizeModel(model, window.innerWidth, window.innerHeight, store.modelZoom)
  model.position.x += store.modelOffsetX
  model.position.y += store.modelOffsetY
  store.live2dModel = model
  store.modelUrl = url
  store.modelLoaded = true

  // 对着模型真实能力核一遍 adapter，把静默失效变成明确报错
  const capabilities = describeModel(model, url)
  store.modelCapabilities = capabilities
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

/** 设置面板里换模型：卸掉旧模型再装新的，不用重启 */
async function switchModel(url: string): Promise<void> {
  if (!store.pixiApp || url === store.modelUrl) return

  idleScheduler.stop()
  stopAnim()
  resetMotionPriority()

  const previous = store.live2dModel
  const previousUrl = store.modelUrl
  store.live2dModel = null
  store.modelLoaded = false
  store.emotionAdapter = null
  store.modelCapabilities = null
  if (previous) unloadLive2DModel(previous, store.pixiApp)

  clearModelCache()
  try {
    await mountModel(url)
    setStoredModelPath(url)
    modelError.value = ''
    console.log(`[Deskpet] Switched model: ${previousUrl || '(none)'} → ${url}`)
  } catch (err) {
    console.error('[Deskpet] Failed to switch model:', err)
    modelError.value = `模型加载失败: ${err}`
    store.modelUrl = ''
  }
}

store.registerModelSwitcher(switchModel)

/**
 * 开发者工具里可直接调用的适配调试三件套：
 *   deskpetInspectModel()        导出模型能力清单（交给 AI 生成 deskpet-adapter.json）
 *   deskpetTestEmotion('happy')  预览某个情绪的适配效果
 *   deskpetTestAnimation('wave') 预览某个语义动作的适配效果
 * 测试助手走的是与真实指令完全相同的代码路径（store → watcher），所见即线上行为。
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
        `表情 ${caps.expressions.length} 个、参数 ${caps.parameters.length} 个。` +
        '适配规范见 docs/MODEL-ADAPTER-SPEC.md',
    )
    return caps
  }

  ;(window as any).deskpetTestEmotion = (emotion: string) => {
    if (!isDeskpetEmotionValue(emotion)) {
      console.warn(`[Deskpet] 未知情绪 "${emotion}"，可用：${DESKPET_EMOTIONS.join(', ')}`)
      return
    }
    if (!getEmotionTarget(store.emotionAdapter, emotion)) {
      console.warn(`[Deskpet] adapter 里没有映射情绪 "${emotion}"，不会有任何效果`)
      return
    }
    store.currentEmotion = emotion
    store.emotionPulse++
    console.info(`[Deskpet] 测试情绪：${emotion}（6 秒后自动回 neutral）`)
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

  if (typeof (window as any).Live2DCubismCore === 'undefined') {
    modelError.value = '缺少 Cubism 4 运行时'
    return
  }

  // Pixi 应用、滚轮缩放、调试助手先就位再谈模型 ——
  // 否则「models 目录为空 / 首个模型损坏」会把之后的切换功能一并打坏
  try {
    const app = await createPixiApp(container, window.innerWidth, window.innerHeight)
    store.pixiApp = app
    const canvas = app.view as HTMLCanvasElement
    canvas.addEventListener('wheel', onWheel as any, { passive: false } as any)
  } catch (err) {
    console.error('[Deskpet] Failed to create PixiJS app:', err)
    modelError.value = `渲染初始化失败: ${err}`
    return
  }
  installModelInspector()

  const modelUrl = await discoverModel()
  if (!modelUrl) {
    // 不 return：用户放入模型后点「重新扫描」再切换仍然可用
    modelError.value = '未找到 Live2D 模型文件，请将模型放入 public/models/ 目录'
  } else {
    try {
      await mountModel(modelUrl)
      console.log('[Deskpet] Live2D model loaded successfully')
    } catch (err) {
      console.error('[Deskpet] Failed to load Live2D model:', err)
      modelError.value = `模型加载失败: ${err}`
    }
  }

  unsubscribeGlobalCursor = window.electronAPI?.onGlobalCursorPosition?.((position) => {
    mouseX = position.x
    mouseY = position.y
  }) ?? null
  unsubscribeResetModelView = window.electronAPI?.onResetModelView?.(() => {
    resetModelView()
  }) ?? null
  unsubscribeSetHoverFade = window.electronAPI?.onSetHoverFade?.((enabled) => {
    store.hoverFadeEnabled = enabled
  }) ?? null
  unsubscribeScreenshot = window.electronAPI?.onScreenshotCaptured?.((base64) => {
    transport.sendScreenshot(base64)
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

let lastW = window.innerWidth
let lastH = window.innerHeight
let lastZoom = store.modelZoom
let mouseX = window.innerWidth / 2
let mouseY = window.innerHeight / 2

const { onWheel } = useModelZoom(
  store,
  () => ({ x: mouseX, y: mouseY }),
  () => ({ width: window.innerWidth, height: window.innerHeight }),
  (zoom) => { lastZoom = zoom },
)
const { onModelMouseDown, consumeDragOffsets } = useModelDrag()
const { cleanup: cleanupExpression } = useExpressionState(store)
const { playMotionWithPriority, reset: resetMotionPriority } = useMotionPriority(store)
const idleScheduler = useIdleScheduler(playMotionWithPriority, () => idleGroups)
const { getMouthOpen } = useLipSync()
const {
  start: startRecord, stop: stopRecord,
  recordingActive, vadActive,
  enableVad, disableVad, cleanup: cleanupVoice,
} = useVoiceInput()

const micTitle = computed(() => {
  if (vadActive.value) return 'VAD 监听中，点击关闭（右键单次手动录音需先关闭 VAD）'
  if (recordingActive.value) return '录音中，右键结束并发送'
  return '点击开启语音监听（VAD）／右键单次手动录音'
})

function sendVoiceText(text: string) {
  chatStore.addUserMessage(text)
  if (!transport.sendUserText(text)) {
    chatStore.showChatMessage('⚠ 未连接到 MaiBot，这条消息没有发出去')
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
    // enableVad 内部已回滚状态并打日志，这里只需要不让异常冒出去
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
  }
}

function startAnimationPoll() {
  const tick = () => {
    // 只在模型就绪时消费：热切换空窗期把指令吃掉会静默丢失动作
    if (store.live2dModel && store.pendingAnimation) {
      const pending = store.consumePendingAnimation()!
      const target = getAnimationTarget(store.emotionAdapter, pending.name)
      if (target?.motion) {
        playMotionWithPriority(target.motion.group, MotionLayer.Reply, target.motion.index ?? 0)
        idleScheduler.notifyInteraction()
      } else {
        console.debug(`[Deskpet] No animation adapter target: ${pending.name}`)
      }
    }
    if (store.live2dModel) {
      const cw = window.innerWidth
      const ch = window.innerHeight
      if (cw !== lastW || ch !== lastH) {
        store.pixiApp!.renderer.resize(cw * RESOLUTION, ch * RESOLUTION)
        store.pixiApp!.stage.scale.set(RESOLUTION)
        lastW = cw
        lastH = ch
        resizeModelFit(store.live2dModel, cw, ch, store.modelZoom)
        store.live2dModel.position.x += store.modelOffsetX
        store.live2dModel.position.y += store.modelOffsetY
      }
      if (store.modelZoom !== lastZoom) {
        lastZoom = store.modelZoom
        // zoom focal point is handled in onWheel, not here
        resizeModel(store.live2dModel, cw, ch, store.modelZoom)
      }
      const dragOffsets = consumeDragOffsets()
      if (dragOffsets) {
        store.live2dModel.position.x += dragOffsets.x
        store.live2dModel.position.y += dragOffsets.y
        // clamp: keep at least 20% of model visible
        const m = store.live2dModel
        const vw = modelRefW * m.scale.x
        const vh = modelRefH * m.scale.y
        m.position.x = Math.max(-vw * 0.8, Math.min(cw + vw * 0.8, m.position.x))
        m.position.y = Math.max(-vh * 0.8, Math.min(ch + vh * 0.8, m.position.y))
        store.setModelOffset(m.position.x - cw / 2, m.position.y - ch / 2)
      }
      // focus() 走 worldTransform，需要画布坐标；舞台缩放了 RESOLUTION 倍，
      // 直接传逻辑坐标会让视线只追到左上四分之一处
      try { store.live2dModel.focus(mouseX * RESOLUTION, mouseY * RESOLUTION) } catch { /* focus not supported */ }
      // 张嘴参数由 adapter 声明，不同模型不一定叫 ParamMouthOpenY
      const lipSync = store.emotionAdapter?.lipSync
      try {
        (store.live2dModel as any).internalModel.coreModel.setParameterValueById(
          lipSync?.mouthOpenParam ?? DEFAULT_LIP_SYNC.mouthOpenParam,
          getMouthOpen() * (lipSync?.gain ?? DEFAULT_LIP_SYNC.gain),
        )
      } catch { /* lip sync param not available */ }
    }
    animFrameId = requestAnimationFrame(tick)
  }
  animFrameId = requestAnimationFrame(tick)
}

function onMouseMove(e: MouseEvent) {
  mouseX = e.clientX
  mouseY = e.clientY
}

window.addEventListener('mousemove', onMouseMove)
onUnmounted(() => {
  stopAnim()
  if (animFrameId) cancelAnimationFrame(animFrameId)
  unsubscribeGlobalCursor?.()
  unsubscribeGlobalCursor = null
  unsubscribeResetModelView?.()
  unsubscribeResetModelView = null
  unsubscribeSetHoverFade?.()
  unsubscribeSetHoverFade = null
  unsubscribeScreenshot?.()
  unsubscribeScreenshot = null
  cleanupExpression()
  cleanupVoice()
  idleScheduler.stop()
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
  store.modelLoaded = false
  store.modelUrl = ''
  delete (window as any).deskpetInspectModel
  delete (window as any).deskpetTestEmotion
  delete (window as any).deskpetTestAnimation
})

function onDoubleClick() {
  showInput.value = true
}

function sendText() {
  const text = inputText.value.trim()
  if (!text) return
  chatStore.addUserMessage(text)
  if (!transport.sendUserText(text)) {
    chatStore.showChatMessage('⚠ 未连接到 MaiBot，这条消息没有发出去')
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
}

.deskpet-stage::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 30;
  opacity: 0;
  transition: opacity 0.25s ease;
  box-shadow:
    inset 0 0 40px 20px rgba(60, 60, 60, 0.25),
    inset 0 0 80px 40px rgba(60, 60, 60, 0.15),
    inset 0 0 140px 70px rgba(60, 60, 60, 0.06);
}

.deskpet-stage.hovered::after {
  opacity: 1;
}

.live2d-stage {
  width: 100%;
  height: 100%;
  display: block;
  transition: opacity 0.18s ease;
}

.deskpet-stage.hover-fade-enabled.hovered .live2d-stage {
  opacity: 0.15;
}

.nav-bar {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 160px;
  height: 32px;
  -webkit-app-region: drag;
  z-index: 50;
  cursor: move;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-bar::after {
  content: '';
  width: 140px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.5);
}

.btn-bar {
  position: absolute;
  bottom: 44px;
  right: 12px;
  z-index: 65;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.btn-bar-item {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(4px);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  transition: background 0.2s;
  user-select: none;
}
.btn-bar-item:hover { background: rgba(255, 255, 255, 0.6); }
.btn-bar-item.recording { background: rgba(255, 60, 60, 0.6); animation: mic-pulse 1s ease-in-out infinite; }
.btn-bar-item.vad { background: rgba(60, 200, 120, 0.6); }
.btn-bar.shifted { right: 216px; }
@keyframes mic-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 60, 60, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(255, 60, 60, 0); }
}

.model-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(16px);
  padding: 40px;
  border-radius: 20px;
  max-width: 350px;
  -webkit-app-region: no-drag;
}
.model-error p {
  font-size: 15px;
  margin: 8px 0;
  line-height: 1.6;
}
.model-error .error-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.model-error .error-hint {
  font-size: 13px;
  opacity: 0.7;
}
.model-error code {
  background: rgba(255, 255, 255, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}
</style>

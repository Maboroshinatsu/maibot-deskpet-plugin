<template>
  <div class="deskpet-stage" :class="{ hovered: isHovered, 'hover-fade-enabled': store.hoverFadeEnabled }" @dblclick="onDoubleClick" @mousedown.left="onModelMouseDown" @mouseenter="isHovered = true" @mouseleave="isHovered = false">
    <div ref="stageRef" class="live2d-stage" />
    <div class="nav-bar" title="拖动窗口，双击重置模型位置和缩放" @mousedown.stop="onNavMouseDown" @dblclick.stop="resetModelView" />

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

    <ChatBubble :visible="showBubble" :text="displayText" :streaming="chatStore.chatBubble.streaming" />

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
import { useDeskpetStore } from '@/stores/deskpet'
import { useChatStore } from '@/stores/chat'
import { useChimeraTransport } from '@/services/transport/chimera'
import { useLive2DAnimation } from '@/composables/useLive2DAnimation'
import { useWindowDrag } from '@/composables/useWindowDrag'
import { useModelZoom } from '@/composables/useModelZoom'
import { useModelDrag } from '@/composables/useModelDrag'
import { useExpressionState } from '@/composables/useExpressionState'
import { useMotionPriority, MotionLayer } from '@/composables/useMotionPriority'
import { useIdleScheduler } from '@/composables/useIdleScheduler'
import { useLipSync } from '@/composables/useLipSync'
import { createPixiApp, loadLive2DModel, resizeModel, resizeModelFit, modelRefW, modelRefH } from '@/services/live2d/loader'
import { discoverModel } from '@/services/live2d/model-discovery'
import { EMOTION_TO_MOTION } from '@/services/protocol'

const store = useDeskpetStore()
const chatStore = useChatStore()
const transport = useChimeraTransport()
const { start: startAnim, stop: stopAnim } = useLive2DAnimation()
const { onNavMouseDown } = useWindowDrag()

const stageRef = ref<HTMLDivElement>()
const inputText = ref('')
const showInput = ref(false)
const isHovered = ref(false)
const showBubble = computed(() => chatStore.chatBubble.visible)
const displayText = computed(() => chatStore.chatBubble.text)
const modelError = ref('')

let animFrameId = 0
let unsubscribeGlobalCursor: (() => void) | null = null
let unsubscribeResetModelView: (() => void) | null = null
let unsubscribeSetHoverFade: (() => void) | null = null

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

  const modelUrl = await discoverModel()
  if (!modelUrl) {
    modelError.value = '未找到 Live2D 模型文件，请将模型放入 public/models/ 目录'
    return
  }

  try {
    const app = await createPixiApp(container, window.innerWidth, window.innerHeight)
    store.pixiApp = app

    const model = await loadLive2DModel(modelUrl, app)
    resizeModel(model, window.innerWidth, window.innerHeight, store.modelZoom)
    model.position.x += store.modelOffsetX
    model.position.y += store.modelOffsetY
    store.live2dModel = model
    store.modelLoaded = true
    idleScheduler.start()

    startAnim(model)
    const canvas = app.view as HTMLCanvasElement
    canvas.addEventListener('wheel', onWheel as any, { passive: false } as any)
    console.log('[Deskpet] Live2D model loaded successfully')
  } catch (err) {
    console.error('[Deskpet] Failed to load Live2D model:', err)
    modelError.value = `模型加载失败: ${err}`
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

  startAnimationPoll()
})

watch(() => store.currentEmotion, (emotion) => {
  if (!store.live2dModel || emotion === 'neutral' || emotion === 'idle') return
  const motionGroup = EMOTION_TO_MOTION[emotion]
  if (motionGroup) {
    playMotionWithPriority(motionGroup, MotionLayer.Reply)
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
const { playMotionWithPriority } = useMotionPriority(store)
const idleScheduler = useIdleScheduler(playMotionWithPriority)
const { getMouthOpen } = useLipSync()

function startAnimationPoll() {
  const tick = () => {
    const pending = store.consumePendingAnimation()
    if (pending && store.live2dModel) {
      playMotionWithPriority(pending.name, MotionLayer.Reply)
      idleScheduler.notifyInteraction()
    }
    if (store.live2dModel) {
      const cw = window.innerWidth
      const ch = window.innerHeight
      if (cw !== lastW || ch !== lastH) {
        store.pixiApp!.renderer.resize(cw * 2, ch * 2)
        store.pixiApp!.stage.scale.set(2)
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
      try { store.live2dModel.focus(mouseX, mouseY) } catch { /* focus not supported */ }
      try {
        (store.live2dModel as any).internalModel.coreModel.setParameterValueById('ParamMouthOpenY', getMouthOpen())
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
  cleanupExpression()
  idleScheduler.stop()
  window.removeEventListener('mousemove', onMouseMove)
  if (store.pixiApp) {
    const canvas = store.pixiApp.view as HTMLCanvasElement
    canvas.removeEventListener('wheel', onWheel as any)
    store.pixiApp.destroy(true, { children: true, texture: true })
    store.pixiApp = null
  }
  store.live2dModel = null
  store.modelLoaded = false
})

function onDoubleClick() {
  showInput.value = true
}

function sendText() {
  const text = inputText.value.trim()
  if (!text) return
  transport.sendUserText(text)
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

onUnmounted(() => { /* cleanup in stopAnim + pixiApp.destroy */ })
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

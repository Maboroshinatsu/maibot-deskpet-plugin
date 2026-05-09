<template>
  <div class="deskpet-stage" :class="{ hovered: isHovered }" @dblclick="onDoubleClick" @mousedown.left="onMouseDown" @mouseenter="isHovered = true" @mouseleave="isHovered = false">
    <div ref="stageRef" class="live2d-stage" />
    <div class="nav-bar" @mousedown.stop />

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

    <Transition name="bubble-fade">
      <div v-if="showBubble" class="chat-bubble">
        <div class="bubble-content">
          <span class="bubble-text">{{ displayText }}</span>
          <span v-if="store.chatBubble.streaming" class="bubble-cursor">|</span>
        </div>
      </div>
    </Transition>

    <Transition name="input-fade">
      <div v-if="showInput" class="quick-input" @mousedown.stop>
        <input
          ref="inputRef"
          v-model="inputText"
          class="input-field"
          placeholder="说点什么..."
          @keydown.enter="sendText"
          @blur="showInput = false"
        />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { useWebSocket } from '@/composables/useWebSocket'
import { useLive2DAnimation } from '@/composables/useLive2DAnimation'
import { createPixiApp, loadLive2DModel, resizeModel, resizeModelFit, playMotion, modelRefW, modelRefH } from '@/services/live2d/loader'
import { discoverModel } from '@/services/live2d/model-discovery'
import { EMOTION_TO_MOTION } from '@/services/protocol'

const store = useDeskpetStore()
const { send } = useWebSocket()
const { start: startAnim, stop: stopAnim } = useLive2DAnimation()

const stageRef = ref<HTMLDivElement>()
const inputRef = ref<HTMLInputElement>()
const inputText = ref('')
const showInput = ref(false)
const isHovered = ref(false)
const showBubble = computed(() => store.chatBubble.visible)
const displayText = computed(() => store.chatBubble.text)
const modelError = ref('')

let animFrameId = 0

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
    store.live2dModel = model
    store.modelLoaded = true

    startAnim(model)
    const canvas = app.view as HTMLCanvasElement
    canvas.addEventListener('wheel', onWheel as any, { passive: false } as any)
    console.log('[Deskpet] Live2D model loaded successfully')
  } catch (err) {
    console.error('[Deskpet] Failed to load Live2D model:', err)
    modelError.value = `模型加载失败: ${err}`
  }

  startAnimationPoll()
})

watch(() => store.currentEmotion, (emotion) => {
  if (!store.live2dModel || emotion === 'neutral' || emotion === 'idle') return
  const motionGroup = EMOTION_TO_MOTION[emotion]
  if (motionGroup) {
    playMotion(store.live2dModel, motionGroup)
  }
})

let lastW = window.innerWidth
let lastH = window.innerHeight
let lastZoom = store.modelZoom
let mouseX = window.innerWidth / 2
let mouseY = window.innerHeight / 2

function startAnimationPoll() {
  const tick = () => {
    const pending = store.consumePendingAnimation()
    if (pending && store.live2dModel) {
      playMotion(store.live2dModel, pending.name)
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
      }
      if (store.modelZoom !== lastZoom) {
        lastZoom = store.modelZoom
        // zoom focal point is handled in onWheel, not here
        resizeModel(store.live2dModel, cw, ch, store.modelZoom)
      }
      if (dragOffsetX !== 0 || dragOffsetY !== 0) {
        store.live2dModel.position.x += dragOffsetX
        store.live2dModel.position.y += dragOffsetY
        dragOffsetX = 0
        dragOffsetY = 0
        // clamp: keep at least 20% of model visible
        const m = store.live2dModel
        const vw = modelRefW * m.scale.x
        const vh = modelRefH * m.scale.y
        m.position.x = Math.max(-vw * 0.8, Math.min(cw + vw * 0.8, m.position.x))
        m.position.y = Math.max(-vh * 0.8, Math.min(ch + vh * 0.8, m.position.y))
      }
      try { store.live2dModel.focus(mouseX, mouseY) } catch { /* focus not supported */ }
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
  setTimeout(() => inputRef.value?.focus(), 50)
}

function sendText() {
  const text = inputText.value.trim()
  if (!text) return
  send('input:text', { text })
  inputText.value = ''
  showInput.value = false
}

let dragOffsetX = 0
let dragOffsetY = 0
let dragActive = false
let dragStartX = 0
let dragStartY = 0
let dragMoved = false

function onMouseDown(e: MouseEvent) {
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragMoved = false
  dragActive = true

  const onMove = (ev: MouseEvent) => {
    if (!dragActive) return
    const dx = ev.clientX - dragStartX
    const dy = ev.clientY - dragStartY
    if (!dragMoved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    dragMoved = true
    dragOffsetX += dx
    dragOffsetY += dy
    dragStartX = ev.clientX
    dragStartY = ev.clientY
  }

  const onUp = () => {
    dragActive = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

let lastWheelTime = 0

function onWheel(e: WheelEvent) {
  e.preventDefault()
  if (!store.live2dModel) return
  const now = performance.now()
  if (now - lastWheelTime < 50) return
  lastWheelTime = now
  const factor = e.deltaY > 0 ? 0.92 : 1.08
  const newZoom = Math.max(0.15, Math.min(20.0, store.modelZoom * factor))
  // zoom toward mouse cursor position
  resizeModel(store.live2dModel, window.innerWidth, window.innerHeight, newZoom, mouseX, mouseY)
  store.modelZoom = newZoom
  lastZoom = newZoom
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

.chat-bubble {
  position: absolute;
  top: 10%;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border-radius: 16px;
  padding: 12px 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 10;
  pointer-events: none;
  -webkit-app-region: no-drag;
}

.bubble-content {
  font-size: 14px;
  line-height: 1.5;
  color: #333;
  word-break: break-word;
}

.bubble-cursor {
  animation: blink 0.8s infinite;
  color: #666;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.quick-input {
  position: absolute;
  bottom: 15%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  min-width: 200px;
  -webkit-app-region: no-drag;
}

.input-field {
  width: 100%;
  padding: 10px 16px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  font-size: 14px;
  outline: none;
  color: #333;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  -webkit-app-region: no-drag;
}

.input-field::placeholder {
  color: #aaa;
}

/* Transitions */
.bubble-fade-enter-active,
.bubble-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.bubble-fade-enter-from,
.bubble-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.input-fade-enter-active,
.input-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.input-fade-enter-from,
.input-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
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

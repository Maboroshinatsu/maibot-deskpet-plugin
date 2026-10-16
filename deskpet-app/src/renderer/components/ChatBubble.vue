<template>
  <!-- 位于窗口下 1/3 处的对话气泡（自动换行，不遮挡角色脸部） -->
  <div class="speech-bubbles-anchor">
    <TransitionGroup name="bubble-pop">
      <div v-if="thinking" key="__thinking__" class="speech-bubble assistant thinking-bubble">
        <span class="dot" /><span class="dot" /><span class="dot" />
      </div>
      <div v-for="b in floatingBubbles" :key="b.id" class="speech-bubble" :class="b.role">
        <img v-if="b.type === 'emoji'" :src="'data:image/png;base64,' + b.base64" class="emoji-img" />
        <template v-else>{{ b.text }}<span v-if="b.streaming" class="msg-cursor">|</span></template>
      </div>
    </TransitionGroup>
  </div>

  <!-- 独立消息记录伴随浮窗（四角方向自适应 + 阻尼滑入/滑出动画） -->
  <Transition name="companion-slide">
    <div
      v-if="panelOpen"
      class="companion-window message-companion"
      :class="[`pop-${popDirectionX}`, `align-${alignY}`]"
      @mousedown.stop
      @wheel.stop
    >
      <div class="comp-header">
        <div class="comp-title">
          <span class="comp-title-dot" />
          <span>消息记录</span>
          <span v-if="messages.length > 0" class="comp-count">{{ messages.length }}</span>
        </div>
        <button class="icon-close-btn" @click="emit('close')" title="收起消息记录">
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="comp-body" ref="messagesRef">
        <div v-for="msg in messages" :key="msg.id" :class="['msg-row', msg.role]">
          <div class="msg-label">{{ msg.role === 'user' ? '你' : (chatStore.botName || 'MaiBot') }}</div>
          <div class="msg-bubble" :class="{ streaming: msg.type === 'text' && msg.streaming }">
            <img v-if="msg.type === 'emoji'" :src="'data:image/png;base64,' + msg.base64" class="emoji-img" />
            <template v-else>{{ msg.text }}<span v-if="msg.streaming" class="msg-cursor">|</span></template>
          </div>
        </div>
        <div v-if="messages.length === 0" class="msg-empty">
          <div class="msg-empty-title">暂无消息记录</div>
          <div class="msg-empty-hint">双击桌宠唤出输入框<br />或点击侧边麦克风开启语音</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { useChatStore, type ChatMessage } from '@/stores/chat'

const chatStore = useChatStore()

const BUBBLE_TTL = 5000
const STREAMING_BUBBLE_TTL = 30_000

interface FloatingBubble {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  type: 'text' | 'emoji'
  base64?: string
}

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[]
    lastBubble: { text: string; visible: boolean; streaming: boolean }
    panelOpen: boolean
    thinking: boolean
    popDirectionX?: 'left' | 'right'
    alignY?: 'bottom' | 'top'
  }>(),
  {
    popDirectionX: 'left',
    alignY: 'bottom',
  },
)

const emit = defineEmits<{ 'bubbles-cleared': []; close: [] }>()

const floatingBubbles = ref<FloatingBubble[]>([])
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleDismiss(msgId: string, ttl = BUBBLE_TTL, replace = false) {
  const existing = timers.get(msgId)
  if (existing) {
    if (!replace) return
    clearTimeout(existing)
  }
  const t = setTimeout(() => {
    timers.delete(msgId)
    floatingBubbles.value = floatingBubbles.value.filter((b) => b.id !== msgId)
    if (floatingBubbles.value.length === 0) emit('bubbles-cleared')
  }, ttl)
  timers.set(msgId, t)
}

watch(
  () => {
    const latest = props.messages[props.messages.length - 1]
    if (!latest) return ''
    return latest.type === 'text'
      ? `${latest.id}:${latest.text.length}:${latest.streaming}`
      : latest.id
  },
  () => {
    const latest = props.messages[props.messages.length - 1]
    if (!latest || latest.role !== 'assistant') return
    // 启动时从磁盘恢复的历史消息不弹气泡，只留在消息记录面板里
    if (latest.restored) return
    const existing = floatingBubbles.value.find((b) => b.id === latest.id)
    if (existing) {
      if (latest.type === 'text') {
        existing.text = latest.text
        existing.streaming = latest.streaming
      }
    } else {
      const fb: FloatingBubble =
        latest.type === 'emoji'
          ? { id: latest.id, role: 'assistant', text: '', streaming: false, type: 'emoji', base64: latest.base64 }
          : { id: latest.id, role: 'assistant', text: latest.text, streaming: latest.streaming, type: 'text' }
      floatingBubbles.value.push(fb)
      if (floatingBubbles.value.length > 2) {
        const removed = floatingBubbles.value.shift()!
        const t = timers.get(removed.id)
        if (t) {
          clearTimeout(t)
          timers.delete(removed.id)
        }
      }
    }
    if (latest.type === 'emoji' || !latest.streaming) {
      scheduleDismiss(latest.id)
    } else {
      scheduleDismiss(latest.id, STREAMING_BUBBLE_TTL)
    }
  },
)

watch(
  () => props.lastBubble.streaming,
  (streaming) => {
    if (streaming) return
    const latest = props.messages[props.messages.length - 1]
    if (!latest || latest.role !== 'assistant') return
    const fb = floatingBubbles.value.find((b) => b.id === latest.id)
    if (fb) fb.streaming = false
    scheduleDismiss(latest.id, BUBBLE_TTL, true)
  },
)

const messagesRef = ref<HTMLElement>()
watch(
  () => props.panelOpen,
  (open) => {
    if (open) {
      nextTick(() => {
        if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      })
    }
  },
)
watch(
  () => props.messages.length,
  () => {
    if (props.panelOpen) {
      nextTick(() => {
        if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      })
    }
  },
)

onUnmounted(() => {
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
})
</script>

<style scoped>
/* ── 位于窗口下 1/3 处的对话气泡（跟随角色水平偏移，自动换行，不遮挡脸部） ── */
.speech-bubbles-anchor {
  position: absolute;
  top: 58%;
  width: 256px;
  max-width: calc(100vw - 32px);
  left: calc(50% - 128px + var(--stage-shift-x, 0px));
  z-index: 25;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: left 0.56s var(--spring-gentle);
}

.speech-bubble {
  max-width: 256px;
  padding: 9px 14px;
  border-radius: 14px;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.55;
  color: var(--dp-text-main);
  background: var(--dp-panel-bg);
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  word-break: break-word;
  overflow-wrap: anywhere;
  text-align: left;
  position: relative;
}

.speech-bubble::before {
  content: '';
  position: absolute;
  top: -5px;
  left: calc(50% - 4px);
  transform: rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--dp-panel-bg);
  border-left: 1px solid var(--dp-border-strong);
  border-top: 1px solid var(--dp-border-strong);
}

.msg-cursor {
  animation: blink 0.8s infinite;
  color: var(--dp-accent);
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}

.emoji-img {
  max-width: 150px;
  max-height: 150px;
  border-radius: 8px;
  display: block;
}

/* 正在思考指示器 */
.thinking-bubble {
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 11px 16px;
}
.thinking-bubble .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dp-accent);
  animation: think-bounce 1.2s ease-in-out infinite;
}
.thinking-bubble .dot:nth-child(2) {
  animation-delay: 0.15s;
}
.thinking-bubble .dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes think-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.bubble-pop-enter-active {
  transition:
    opacity 0.2s var(--ease-out-expo),
    transform 0.24s var(--ease-out-expo);
}
.bubble-pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.18s ease;
}
.bubble-pop-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.bubble-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── 独立消息记录伴随浮窗 ── */
.companion-window {
  position: absolute;
  width: 296px;
  height: min(468px, calc(100vh - 52px));
  background: var(--dp-panel-bg);
  border: none;
  border-radius: 28px;
  box-shadow: var(--dp-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 66;
  color: var(--dp-text-main);
  -webkit-app-region: no-drag;
  transition: background-color 0.28s ease, color 0.28s ease, box-shadow 0.28s ease;
}

.companion-window.pop-left {
  left: 12px;
  --slide-x: 18px;
}

.companion-window.pop-right {
  right: 12px;
  --slide-x: -18px;
}

.companion-window.align-bottom {
  bottom: 36px;
}

.companion-window.align-top {
  top: 20px;
}

.companion-slide-enter-active {
  transition:
    opacity 200ms var(--ease-out-expo),
    transform 240ms var(--ease-out-expo);
}

.companion-slide-leave-active {
  transition:
    opacity 150ms ease,
    transform 170ms ease;
}

.companion-slide-enter-from,
.companion-slide-leave-to {
  opacity: 0;
  transform: translateX(var(--slide-x, 18px));
}

.comp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 10px;
  flex-shrink: 0;
}

.comp-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--dp-text-main);
  display: flex;
  align-items: center;
  gap: 8px;
}

.comp-title-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dp-orb-grad);
  box-shadow: 0 2px 8px var(--dp-accent-glow);
}

.comp-count {
  color: var(--dp-text-sub);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 8px;
  background: var(--dp-card-bg);
}

.icon-close-btn {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  border: none;
  background: var(--dp-card-bg);
  color: var(--dp-icon);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    transform 460ms var(--spring-gentle) 45ms;
}

.icon-close-btn:hover {
  background: var(--dp-card-hover);
  color: var(--dp-text-main);
}

.icon-close-btn:active {
  transform: scale(0.92);
  transition: transform 95ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}

.icon-close-btn svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}

.comp-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.comp-body::-webkit-scrollbar {
  width: 4px;
}
.comp-body::-webkit-scrollbar-thumb {
  background: var(--dp-scrollbar);
  border-radius: 999px;
}

.msg-row {
  display: flex;
  flex-direction: column;
  animation: msg-row-pop 0.24s var(--ease-out-expo);
}

@keyframes msg-row-pop {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.msg-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--dp-text-dim);
  margin-bottom: 4px;
  padding: 0 4px;
}

.msg-row.user {
  align-items: flex-end;
}

.msg-row.user .msg-label {
  color: var(--dp-accent-vivid);
}

.msg-row.assistant {
  align-items: flex-start;
}

.msg-bubble {
  max-width: 90%;
  padding: 9px 13px;
  border-radius: 16px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.55;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: var(--dp-text-main);
}

.msg-row.user .msg-bubble {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
  border-bottom-right-radius: 5px;
  box-shadow: 0 4px 12px -2px var(--dp-accent-glow);
}

.msg-row.assistant .msg-bubble {
  background: var(--dp-card-bg);
  border: none;
  border-bottom-left-radius: 5px;
}

.msg-empty {
  text-align: center;
  margin-top: 42px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.msg-empty-title {
  color: var(--dp-text-main);
  font-size: 13px;
  font-weight: 600;
}

.msg-empty-hint {
  color: var(--dp-text-sub);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.65;
}
</style>

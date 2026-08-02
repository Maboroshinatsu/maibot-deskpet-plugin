<template>
  <!-- floating comic bubbles (text + emoji) -->
  <div class="comic-bubbles">
    <TransitionGroup name="comic-pop">
      <div v-if="thinking" key="__thinking__" class="comic-bubble assistant thinking-bubble">
        <span class="dot" /><span class="dot" /><span class="dot" />
      </div>
      <div v-for="b in floatingBubbles" :key="b.id" class="comic-bubble" :class="b.role">
        <img v-if="b.type === 'emoji'" :src="'data:image/png;base64,' + b.base64" class="emoji-img" />
        <template v-else>{{ b.text }}<span v-if="b.streaming" class="msg-cursor">|</span></template>
      </div>
    </TransitionGroup>
  </div>

  <!-- chat history panel（与设置面板同一套交互：遮罩 + 右侧抽屉 + 头部关闭） -->
  <Transition name="panel-slide">
    <div v-if="panelOpen" class="chat-overlay" @mousedown.stop>
      <div class="chat-panel">
      <div class="panel-header">
        <span>对话记录</span>
        <span class="panel-header-right">
          <span class="panel-count">{{ messages.length }}</span>
          <button class="panel-close" @click="emit('close')">&times;</button>
        </span>
      </div>
      <div class="panel-messages" ref="messagesRef">
        <div v-for="msg in messages" :key="msg.id" :class="['msg-row', msg.role]">
          <div class="msg-label">{{ msg.role === 'user' ? '你' : '麦麦' }}</div>
          <div class="msg-bubble" :class="{ streaming: msg.type === 'text' && msg.streaming }">
            <img v-if="msg.type === 'emoji'" :src="'data:image/png;base64,' + msg.base64" class="emoji-img" />
            <template v-else>{{ msg.text }}<span v-if="msg.streaming" class="msg-cursor">|</span></template>
          </div>
        </div>
        <div v-if="messages.length === 0" class="msg-empty">
          <div class="msg-empty-title">还没有消息</div>
          <div class="msg-empty-hint">双击桌宠打开输入框<br />或点左下麦克风开始语音</div>
        </div>
      </div>
      </div>
    </div>
  </Transition>

</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'
import type { ChatMessage } from '@/stores/chat'

const BUBBLE_TTL = 5000
/** 流式气泡的兜底存活时间：output:text:done 帧丢失时不至于永久挂在屏幕上 */
const STREAMING_BUBBLE_TTL = 30_000

interface FloatingBubble {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  type: 'text' | 'emoji'
  base64?: string
}

const props = defineProps<{
  messages: ChatMessage[]
  lastBubble: { text: string; visible: boolean; streaming: boolean }
  panelOpen: boolean
  thinking: boolean
}>()

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

// 不能只盯 length：流式 delta 只改 text 不改 length（气泡会冻结在第一个字块），
// 消息数到达上限后 push+splice 使 length 恒定（之后所有新气泡都不出现）
watch(() => {
  const latest = props.messages[props.messages.length - 1]
  if (!latest) return ''
  return latest.type === 'text'
    ? `${latest.id}:${latest.text.length}:${latest.streaming}`
    : latest.id
}, () => {
  const latest = props.messages[props.messages.length - 1]
  if (!latest || latest.role !== 'assistant') return
  const existing = floatingBubbles.value.find((b) => b.id === latest.id)
  if (existing) {
    if (latest.type === 'text') { existing.text = latest.text; existing.streaming = latest.streaming }
  } else {
    const fb: FloatingBubble = latest.type === 'emoji'
      ? { id: latest.id, role: 'assistant', text: '', streaming: false, type: 'emoji', base64: latest.base64 }
      : { id: latest.id, role: 'assistant', text: latest.text, streaming: latest.streaming, type: 'text' }
    floatingBubbles.value.push(fb)
    if (floatingBubbles.value.length > 2) {
      const removed = floatingBubbles.value.shift()!
      const t = timers.get(removed.id)
      if (t) { clearTimeout(t); timers.delete(removed.id) }
    }
  }
  if (latest.type === 'emoji' || !latest.streaming) {
    scheduleDismiss(latest.id)
  } else {
    // 流式气泡也挂兜底：正常结束时会被 5 秒的正式 TTL 替换
    scheduleDismiss(latest.id, STREAMING_BUBBLE_TTL)
  }
})

watch(() => props.lastBubble.streaming, (streaming) => {
  if (streaming) return
  const latest = props.messages[props.messages.length - 1]
  if (!latest || latest.role !== 'assistant') return
  const fb = floatingBubbles.value.find((b) => b.id === latest.id)
  if (fb) fb.streaming = false
  // 流正常结束：把 30 秒兜底换成 5 秒正式 TTL
  scheduleDismiss(latest.id, BUBBLE_TTL, true)
})

const messagesRef = ref<HTMLElement>()
watch(() => props.panelOpen, (open) => {
  if (open) nextTick(() => { if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight })
})
watch(() => props.messages.length, () => {
  if (props.panelOpen) nextTick(() => { if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight })
})

onUnmounted(() => {
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
})
</script>

<style scoped>
/* ── comic floating bubbles ── */
.comic-bubbles {
  position: absolute;
  top: 14%;
  left: 4%;
  z-index: 15;
  pointer-events: none;
  display: flex;
  flex-direction: column-reverse;
  gap: 6px;
}
.comic-bubble {
  max-width: 340px;
  padding: 12px 18px;
  border-radius: 20px 20px 6px 20px;
  font-size: 15px;
  line-height: 1.55;
  color: #222;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 14px rgba(0,0,0,0.12);
  position: relative;
}
.comic-bubble::after {
  content: '';
  position: absolute;
  bottom: 6px;
  right: -6px;
  width: 12px;
  height: 12px;
  background: inherit;
  clip-path: polygon(0 0, 100% 100%, 0 100%);
}
.msg-cursor { animation: blink 0.8s infinite; color: #666; }
.comic-bubble.user .msg-cursor { color: #b0d0ff; }
@keyframes blink { 50% { opacity: 0; } }
.emoji-img { max-width: 180px; max-height: 180px; border-radius: 8px; display: block; }

/* 「正在思考」指示器：后端发 state:thinking 时显示 */
.thinking-bubble { display: flex; gap: 5px; align-items: center; padding: 14px 18px; }
.thinking-bubble .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #888;
  animation: think-bounce 1.2s ease-in-out infinite;
}
.thinking-bubble .dot:nth-child(2) { animation-delay: 0.15s; }
.thinking-bubble .dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes think-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-4px); opacity: 1; }
}
.comic-pop-enter-active { transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
.comic-pop-leave-active { transition: all 0.4s ease; }
.comic-pop-enter-from { opacity: 0; transform: translateY(16px) scale(0.9); }
.comic-pop-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── history panel：与 SettingsPanel 同一套抽屉模式 ── */
.chat-overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
  background: linear-gradient(to left, rgba(9, 9, 11, 0.35), transparent 45%);
}
.chat-panel {
  width: 280px;
  height: 100%;
  background: rgba(24, 24, 27, 0.94);
  backdrop-filter: blur(20px) saturate(1.2);
  border-left: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow: -24px 0 48px -24px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 15px 18px 13px;
  color: #e4e4e7; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.panel-header-right { display: flex; align-items: center; gap: 8px; }
.panel-count { color: #63636b; font-family: ui-monospace, Consolas, monospace; font-size: 11px; font-weight: 400; }
.panel-close {
  width: 26px; height: 26px; display: grid; place-items: center;
  background: none; border: none; border-radius: 8px; color: #71717a; font-size: 18px; cursor: pointer;
  transition: color 0.18s ease, background 0.18s ease;
}
.panel-close:hover { color: #e4e4e7; background: rgba(255, 255, 255, 0.08); }
.panel-close:active { transform: translateY(1px); }
.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.panel-messages::-webkit-scrollbar { width: 7px; }
.panel-messages::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12); border-radius: 4px;
  border: 2px solid transparent; background-clip: padding-box;
}
.msg-row { display: flex; flex-direction: column; }
.msg-label { font-size: 10px; color: #71717a; margin-bottom: 2px; padding: 0 4px; }
.msg-row.user { align-items: flex-end; }
.msg-row.user .msg-label { color: #8fb4d9; }
.msg-row.assistant { align-items: flex-start; }
.msg-bubble {
  max-width: 90%;
  padding: 6px 10px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
  color: #e4e4e7;
}
.msg-row.user .msg-bubble {
  background: rgba(109, 155, 209, 0.28);
  border: 1px solid rgba(109, 155, 209, 0.22);
  border-bottom-right-radius: 3px;
}
.msg-row.assistant .msg-bubble {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-bottom-left-radius: 3px;
}
.msg-empty { text-align: center; margin-top: 36px; display: flex; flex-direction: column; gap: 6px; }
.msg-empty-title { color: #a1a1aa; font-size: 12px; }
.msg-empty-hint { color: #63636b; font-size: 11px; line-height: 1.7; }
.panel-slide-enter-active, .panel-slide-leave-active { transition: opacity 0.28s ease; }
.panel-slide-enter-from, .panel-slide-leave-to { opacity: 0; }
.panel-slide-enter-active .chat-panel, .panel-slide-leave-active .chat-panel {
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.panel-slide-enter-from .chat-panel, .panel-slide-leave-to .chat-panel { transform: translateX(48px); }
</style>

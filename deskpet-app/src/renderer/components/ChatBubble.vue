<template>
  <!-- floating comic bubbles (text + emoji) -->
  <div class="comic-bubbles">
    <TransitionGroup name="comic-pop">
      <div v-for="b in floatingBubbles" :key="b.id" class="comic-bubble" :class="b.role">
        <img v-if="b.type === 'emoji'" :src="'data:image/png;base64,' + b.base64" class="emoji-img" />
        <template v-else>{{ b.text }}<span v-if="b.streaming" class="msg-cursor">|</span></template>
      </div>
    </TransitionGroup>
  </div>

  <!-- chat history panel -->
  <Transition name="panel-slide">
    <div v-if="panelOpen" class="chat-panel" @mousedown.stop>
      <div class="panel-messages" ref="messagesRef">
        <div v-for="msg in messages" :key="msg.id" :class="['msg-row', msg.role]">
          <div class="msg-label">{{ msg.role === 'user' ? '你' : '麦麦' }}</div>
          <div class="msg-bubble" :class="{ streaming: 'streaming' in msg && msg.streaming }">
            <img v-if="msg.type === 'emoji'" :src="'data:image/png;base64,' + msg.base64" class="emoji-img" />
            <template v-else>{{ msg.text }}<span v-if="'streaming' in msg && msg.streaming" class="msg-cursor">|</span></template>
          </div>
        </div>
        <div v-if="messages.length === 0" class="msg-empty">暂无消息</div>
      </div>
    </div>
  </Transition>

</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { ChatMessage } from '@/stores/chat'

const BUBBLE_TTL = 5000

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
}>()

const emit = defineEmits<{ toggle: []; 'bubbles-cleared': [] }>()

const floatingBubbles = ref<FloatingBubble[]>([])
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleDismiss(msgId: string) {
  if (timers.has(msgId)) return
  const t = setTimeout(() => {
    timers.delete(msgId)
    floatingBubbles.value = floatingBubbles.value.filter((b) => b.id !== msgId)
    if (floatingBubbles.value.length === 0) emit('bubbles-cleared')
  }, BUBBLE_TTL)
  timers.set(msgId, t)
}

watch(() => props.messages.length, () => {
  const latest = props.messages[props.messages.length - 1]
  if (!latest || latest.role !== 'assistant') return
  const existing = floatingBubbles.value.find((b) => b.id === latest.id)
  if (existing) {
    if (latest.type === 'text' && 'text' in latest) { existing.text = latest.text; existing.streaming = latest.streaming }
  } else {
    const fb: FloatingBubble = latest.type === 'emoji' && 'base64' in latest
      ? { id: latest.id, role: 'assistant', text: '', streaming: false, type: 'emoji', base64: latest.base64 }
      : { id: latest.id, role: 'assistant', text: 'text' in latest ? latest.text : '', streaming: 'streaming' in latest ? latest.streaming : false, type: 'text' }
    floatingBubbles.value.push(fb)
    if (floatingBubbles.value.length > 2) {
      const removed = floatingBubbles.value.shift()!
      const t = timers.get(removed.id)
      if (t) { clearTimeout(t); timers.delete(removed.id) }
    }
  }
  if (latest.type === 'emoji' || ('streaming' in latest && !latest.streaming)) scheduleDismiss(latest.id)
})

watch(() => props.lastBubble.streaming, (streaming) => {
  if (streaming) return
  const latest = props.messages[props.messages.length - 1]
  if (!latest || latest.role !== 'assistant') return
  const fb = floatingBubbles.value.find((b) => b.id === latest.id)
  if (fb) fb.streaming = false
  scheduleDismiss(latest.id)
})

const messagesRef = ref<HTMLElement>()
watch(() => props.panelOpen, (open) => {
  if (open) nextTick(() => { if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight })
})
watch(() => props.messages.length, () => {
  if (props.panelOpen) nextTick(() => { if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight })
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
.comic-pop-enter-active { transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
.comic-pop-leave-active { transition: all 0.4s ease; }
.comic-pop-enter-from { opacity: 0; transform: translateY(16px) scale(0.9); }
.comic-pop-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── history panel ── */
.chat-panel {
  position: absolute;
  right: 6px;
  top: 6px;
  bottom: 90px;
  width: 200px;
  background: rgba(16, 16, 20, 0.94);
  backdrop-filter: blur(14px);
  border-radius: 12px;
  z-index: 60;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.msg-row { display: flex; flex-direction: column; }
.msg-label { font-size: 10px; color: #777; margin-bottom: 2px; padding: 0 4px; }
.msg-row.user { align-items: flex-end; }
.msg-row.user .msg-label { color: #7cb8e4; }
.msg-row.assistant { align-items: flex-start; }
.msg-row.assistant .msg-label { color: #a0d1eb; }
.msg-bubble {
  max-width: 90%;
  padding: 6px 10px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
  color: #eee;
}
.msg-row.user .msg-bubble { background: rgba(70, 130, 200, 0.5); border-bottom-right-radius: 3px; }
.msg-row.assistant .msg-bubble { background: rgba(255,255,255,0.12); border-bottom-left-radius: 3px; }
.msg-empty { color: #666; font-size: 12px; text-align: center; margin-top: 20px; }
.panel-slide-enter-active, .panel-slide-leave-active { transition: all 0.25s ease; }
.panel-slide-enter-from, .panel-slide-leave-to { opacity: 0; transform: translateX(16px); }
</style>

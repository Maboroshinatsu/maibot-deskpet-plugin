import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/** 聊天记录上限，超出后丢弃最旧的消息，避免长时间挂机内存持续增长 */
const MAX_MESSAGES = 200

export interface TextMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  timestamp: number
  type: 'text'
  /** 流式分组用；只在 streaming 中的消息上匹配，后端缺 request_id 时不会把所有回复并进一条 */
  requestId?: string
}

export interface EmojiMessage {
  id: string
  role: 'assistant'
  base64: string
  description: string
  timestamp: number
  type: 'emoji'
}

export type ChatMessage = TextMessage | EmojiMessage

let idSeq = 0
/** Date.now() 同毫秒内会碰撞（连发表情包、快速输入），补个单调序号保证 :key 唯一 */
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++idSeq}`
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])

  // backward-compat: last assistant bubble
  const chatBubble = computed(() => {
    const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
    return {
      text: last && last.type === 'text' ? last.text : '',
      visible: !!last,
      streaming: last?.type === 'text' ? last.streaming : false,
      requestId: last?.id || null,
    }
  })

  function push(msg: ChatMessage) {
    messages.value.push(msg)
    if (messages.value.length > MAX_MESSAGES) {
      messages.value.splice(0, messages.value.length - MAX_MESSAGES)
    }
  }

  function addUserMessage(text: string) {
    push({
      id: nextId('user'),
      role: 'user',
      text,
      streaming: false,
      timestamp: Date.now(),
      type: 'text',
    })
  }

  function findStreamingMessage(requestId: string): TextMessage | undefined {
    return messages.value.find(
      (m): m is TextMessage =>
        m.type === 'text' && m.role === 'assistant' && m.streaming && m.requestId === requestId,
    )
  }

  function appendChatText(delta: string, requestId: string) {
    const existing = findStreamingMessage(requestId)
    if (existing) {
      existing.text += delta
    } else {
      push({
        id: nextId('assistant'),
        requestId,
        role: 'assistant',
        text: delta,
        streaming: true,
        timestamp: Date.now(),
        type: 'text',
      })
    }
  }

  function finishChatStream(requestId: string) {
    const msg = findStreamingMessage(requestId)
    if (msg) msg.streaming = false
  }

  function showChatMessage(text: string) {
    push({
      id: nextId('assistant'),
      role: 'assistant',
      text,
      streaming: false,
      timestamp: Date.now(),
      type: 'text',
    })
  }

  function addEmojiMessage(base64: string, description: string) {
    push({
      id: nextId('emoji'),
      role: 'assistant',
      base64,
      description,
      timestamp: Date.now(),
      type: 'emoji',
    })
  }

  function clear() {
    messages.value = []
  }

  return {
    messages,
    chatBubble,
    addUserMessage,
    addEmojiMessage,
    appendChatText,
    finishChatStream,
    showChatMessage,
    clear,
  }
})

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ChatMessage =
  | {
      id: string
      role: 'user' | 'assistant'
      text: string
      streaming: boolean
      timestamp: number
      type: 'text'
    }
  | {
      id: string
      role: 'assistant'
      base64: string
      description: string
      timestamp: number
      type: 'emoji'
    }

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])

  // backward-compat: last assistant bubble
  const chatBubble = computed(() => {
    const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
    return {
      text: last?.text || '',
      visible: !!last,
      streaming: last?.streaming || false,
      requestId: last?.id || null,
    }
  })

  function addUserMessage(text: string) {
    messages.value.push({
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      streaming: false,
      timestamp: Date.now(),
    })
  }

  function appendChatText(delta: string, requestId: string) {
    const existing = messages.value.find((m) => m.id === requestId)
    if (existing) {
      existing.text += delta
    } else {
      messages.value.push({
        id: requestId,
        role: 'assistant',
        text: delta,
        streaming: true,
        timestamp: Date.now(),
      })
    }
  }

  function finishChatStream(requestId: string) {
    const msg = messages.value.find((m) => m.id === requestId)
    if (msg) msg.streaming = false
  }

  function showChatMessage(text: string) {
    messages.value.push({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      text,
      streaming: false,
      timestamp: Date.now(),
    })
  }

  function addEmojiMessage(base64: string, description: string) {
    messages.value.push({
      id: `emoji-${Date.now()}`,
      role: 'assistant',
      base64,
      description,
      timestamp: Date.now(),
      type: 'emoji',
    })
  }

  function hideChatBubble() {
    // no-op — messages stay in history
  }

  return {
    messages,
    chatBubble,
    addUserMessage,
    addEmojiMessage,
    appendChatText,
    finishChatStream,
    showChatMessage,
    hideChatBubble,
  }
})

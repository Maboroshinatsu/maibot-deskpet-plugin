import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ChatBubbleState {
  text: string
  visible: boolean
  streaming: boolean
  requestId: string | null
}

export const useChatStore = defineStore('chat', () => {
  const chatBubble = ref<ChatBubbleState>({
    text: '',
    visible: false,
    streaming: false,
    requestId: null,
  })

  function appendChatText(delta: string, requestId: string) {
    if (!chatBubble.value.visible || chatBubble.value.requestId !== requestId) {
      chatBubble.value = { text: delta, visible: true, streaming: true, requestId }
    } else {
      chatBubble.value.text += delta
    }
  }

  function finishChatStream(requestId: string) {
    if (chatBubble.value.requestId === requestId) {
      chatBubble.value.streaming = false
    }
  }

  function showChatMessage(text: string) {
    chatBubble.value = { text, visible: true, streaming: false, requestId: null }
  }

  function hideChatBubble() {
    chatBubble.value.visible = false
  }

  return {
    chatBubble,
    appendChatText,
    finishChatStream,
    showChatMessage,
    hideChatBubble,
  }
})

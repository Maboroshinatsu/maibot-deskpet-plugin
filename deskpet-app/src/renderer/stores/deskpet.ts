import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { Application } from '@pixi/app'

export interface ChatBubbleState {
  text: string
  visible: boolean
  streaming: boolean
  requestId: string | null
}

export const useDeskpetStore = defineStore('deskpet', () => {
  const wsConnected = ref(false)
  const pixiApp = shallowRef<Application | null>(null)
  const live2dModel = shallowRef<Live2DModel | null>(null)
  const modelLoaded = ref(false)
  const modelZoom = ref(1.0)

  const chatBubble = ref<ChatBubbleState>({
    text: '',
    visible: false,
    streaming: false,
    requestId: null
  })

  const currentEmotion = ref('neutral')
  const isThinking = ref(false)
  const pendingAnimation = ref<string | null>(null)
  const pendingAnimationLoop = ref(false)

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

  function consumePendingAnimation(): { name: string; loop: boolean } | null {
    if (!pendingAnimation.value) return null
    const result = { name: pendingAnimation.value, loop: pendingAnimationLoop.value }
    pendingAnimation.value = null
    pendingAnimationLoop.value = false
    return result
  }

  return {
    wsConnected,
    pixiApp,
    live2dModel,
    modelLoaded,
    modelZoom,
    chatBubble,
    currentEmotion,
    isThinking,
    pendingAnimation,
    pendingAnimationLoop,
    appendChatText,
    finishChatStream,
    showChatMessage,
    hideChatBubble,
    consumePendingAnimation
  }
})

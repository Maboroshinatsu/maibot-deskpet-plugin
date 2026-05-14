import { ref, onMounted, onUnmounted } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { useChatStore } from '@/stores/chat'
import { useSpeechSynthesis } from './useSpeechSynthesis'
import { useLipSync } from './useLipSync'

const DEFAULT_URL = 'ws://127.0.0.1:8523/ws'

interface WSMessage {
  type: string
  data: any
  timestamp?: number
  request_id?: string
}

export function useWebSocket(url: string = DEFAULT_URL) {
  const store = useDeskpetStore()
  const chatStore = useChatStore()
  const { speak: browserSpeak, cancel: cancelSpeech } = useSpeechSynthesis()
  const { attach: attachLipSync, detach: detachLipSync } = useLipSync()

  async function speak(text: string) {
    try {
      const data = await window.electronAPI?.ttsSpeak(text)
      if (data && data.byteLength > 0) {
        const blob = new Blob([data], { type: 'audio/wav' })
        const audio = new Audio(URL.createObjectURL(blob))
        attachLipSync(audio)
        audio.onended = () => detachLipSync()
        audio.onerror = () => detachLipSync()
        audio.play()
        return
      }
    } catch { /* fall through to browser TTS */ }
    browserSpeak(text)
  }

  const ws = ref<WebSocket | null>(null)
  const heartbeatTimer = ref<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimer = ref<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempt = ref(0)
  const maxReconnectDelay = 30000

  function connect() {
    if (ws.value?.readyState === WebSocket.OPEN) return

    try {
      ws.value = new WebSocket(url)
    } catch (e) {
      console.warn('[Deskpet] WebSocket connect failed, retrying...')
      scheduleReconnect()
      return
    }

    ws.value.onopen = () => {
      console.log('[Deskpet] WebSocket connected')
      store.wsConnected = true
      reconnectAttempt.value = 0
      startHeartbeat()
    }

    ws.value.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data)
        handleMessage(msg)
      } catch (e) {
        console.warn('[Deskpet] Failed to parse message:', e)
      }
    }

    ws.value.onclose = () => {
      console.log('[Deskpet] WebSocket disconnected')
      store.wsConnected = false
      stopHeartbeat()
      scheduleReconnect()
    }

    ws.value.onerror = () => {
      ws.value?.close()
    }
  }

  function handleMessage(msg: WSMessage) {
    const { type, data, request_id } = msg

    switch (type) {
      case 'output:text:delta':
        chatStore.appendChatText(data.delta, request_id || data.request_id || '')
        break

      case 'output:text:done':
        chatStore.finishChatStream(request_id || data.request_id || '')
        if (!data.error) {
          speak(chatStore.chatBubble.text)
          setTimeout(() => chatStore.hideChatBubble(), 8000)
        }
        break

      case 'output:text':
        chatStore.showChatMessage(data.text)
        speak(data.text)
        setTimeout(() => chatStore.hideChatBubble(), 8000)
        break

      case 'state:emotion':
        store.currentEmotion = data.emotion
        break

      case 'state:animation':
        store.pendingAnimation = data.name
        store.pendingAnimationLoop = !!data.loop
        break

      case 'state:thinking':
        store.isThinking = true
        break

      case 'heartbeat':
        break

      default:
        console.log('[Deskpet] Unknown message type:', type, data)
    }
  }

  function send(type: string, data: Record<string, any> = {}) {
    if (ws.value?.readyState !== WebSocket.OPEN) return false
    ws.value.send(JSON.stringify({ type, data, timestamp: Date.now() }))
    return true
  }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer.value = setInterval(() => {
      send('heartbeat')
    }, 15000)
  }

  function stopHeartbeat() {
    if (heartbeatTimer.value) {
      clearInterval(heartbeatTimer.value)
      heartbeatTimer.value = null
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer.value) return
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.value), maxReconnectDelay)
    reconnectAttempt.value++
    console.log(`[Deskpet] Reconnecting in ${delay}ms (attempt ${reconnectAttempt.value})`)
    reconnectTimer.value = setTimeout(() => {
      reconnectTimer.value = null
      connect()
    }, delay)
  }

  function disconnect() {
    stopHeartbeat()
    cancelSpeech()
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value)
      reconnectTimer.value = null
    }
    ws.value?.close()
    ws.value = null
  }

  onMounted(() => {
    connect()
  })

  onUnmounted(() => {
    disconnect()
  })

  return { ws, connect, disconnect, send }
}

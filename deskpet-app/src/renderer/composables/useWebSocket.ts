import { ref, onMounted, onUnmounted } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { useChatStore } from '@/stores/chat'
import { useLipSync } from './useLipSync'
import { isDeskpetEmotionValue } from '@/services/live2d/emotion-adapter'
import { DEFAULT_WS_URL, type ServerMessage } from '@/services/protocol'

/** TTS 停下后再静默一小段，避免尾音被 VAD 当成用户说话 */
const SPEAKING_TAIL_MS = 400
/** 待排队播放的音频上限，防止后端连续推送时无限堆积 */
const MAX_AUDIO_QUEUE = 8

function getWsUrl(): string {
  try {
    const custom = localStorage.getItem('deskpet/ws-url')
    if (custom) return custom
  } catch { /* localStorage blocked */ }
  return DEFAULT_WS_URL
}

function getWsToken(): string {
  try {
    return localStorage.getItem('deskpet/ws-token') || ''
  } catch { return '' }
}

export function useWebSocket() {
  const url = getWsUrl()
  const token = getWsToken()
  const store = useDeskpetStore()
  const chatStore = useChatStore()
  const { start: startLipSync, stop: stopLipSync } = useLipSync()

  let currentAudio: HTMLAudioElement | null = null
  let currentAudioUrl: string | null = null
  let audioQueue: string[] = []
  let speakingTailTimer: ReturnType<typeof setTimeout> | null = null

  function releaseCurrentAudio() {
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl)
      currentAudioUrl = null
    }
    currentAudio = null
  }

  function markSpeakingEnded() {
    if (speakingTailTimer) clearTimeout(speakingTailTimer)
    speakingTailTimer = setTimeout(() => {
      speakingTailTimer = null
      if (!currentAudio) store.isSpeaking = false
    }, SPEAKING_TAIL_MS)
  }

  function playNextInQueue() {
    releaseCurrentAudio()
    stopLipSync()
    if (audioQueue.length === 0) {
      markSpeakingEnded()
      return
    }
    playAudioNow(audioQueue.shift()!)
  }

  function playAudioNow(base64: string) {
    let objectUrl: string
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
    } catch (err) {
      console.warn('[Deskpet] Bad audio payload:', err)
      playNextInQueue()
      return
    }

    const audio = new Audio(objectUrl)
    currentAudio = audio
    currentAudioUrl = objectUrl
    if (speakingTailTimer) { clearTimeout(speakingTailTimer); speakingTailTimer = null }
    store.isSpeaking = true
    startLipSync()
    audio.onended = () => playNextInQueue()
    audio.onerror = () => playNextInQueue()
    audio.play().catch((err) => {
      console.warn('[Deskpet] Audio playback failed:', err)
      playNextInQueue()
    })
  }

  function playAudio(base64: string) {
    if (currentAudio) {
      if (audioQueue.length >= MAX_AUDIO_QUEUE) {
        console.warn('[Deskpet] Audio queue full, dropping oldest clip')
        audioQueue.shift()
      }
      audioQueue.push(base64)
      return
    }
    playAudioNow(base64)
  }

  function stopAllAudio() {
    audioQueue = []
    if (currentAudio) {
      currentAudio.pause()
      currentAudio.onended = null
      currentAudio.onerror = null
    }
    releaseCurrentAudio()
    stopLipSync()
    if (speakingTailTimer) { clearTimeout(speakingTailTimer); speakingTailTimer = null }
    store.isSpeaking = false
  }

  const ws = ref<WebSocket | null>(null)
  const heartbeatTimer = ref<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimer = ref<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempt = ref(0)
  const maxReconnectDelay = 30000
  /** 连接活过这么久才算“稳定”，此时才把退避计数清零，防止“接受即断”时以 1s 下限死循环 */
  const STABLE_AFTER_MS = 5000
  /** 超过这么久没收到任何服务端消息（含心跳回显）就判定半开连接，强制重连 */
  const LIVENESS_TIMEOUT_MS = 45000
  let stableTimer: ReturnType<typeof setTimeout> | null = null
  let lastActivity = 0
  let closedByUs = false

  function clearStableTimer() {
    if (stableTimer) {
      clearTimeout(stableTimer)
      stableTimer = null
    }
  }

  function connect() {
    // CONNECTING 期间重复 connect 会孤儿化前一个 socket，双连接同时喂 store
    const state = ws.value?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return
    closedByUs = false

    try {
      ws.value = new WebSocket(url)
    } catch {
      console.warn('[Deskpet] WebSocket connect failed, retrying...')
      scheduleReconnect()
      return
    }

    ws.value.onopen = () => {
      console.log('[Deskpet] WebSocket connected')
      store.wsConnected = true
      if (token) send('auth', { token })
      // 重连后插件端的 _model_emotions 可能已丢失或过时，补发当前模型声明的自定义情绪
      if (store.modelEmotions.length > 0) {
        send('sys:emotions', { emotions: store.modelEmotions })
      }
      lastActivity = Date.now()
      clearStableTimer()
      stableTimer = setTimeout(() => {
        stableTimer = null
        reconnectAttempt.value = 0
      }, STABLE_AFTER_MS)
      startHeartbeat()
    }

    ws.value.onmessage = (event) => {
      lastActivity = Date.now()
      try {
        handleMessage(JSON.parse(event.data) as ServerMessage)
      } catch (e) {
        console.warn('[Deskpet] Failed to parse message:', e)
      }
    }

    ws.value.onclose = () => {
      console.log('[Deskpet] WebSocket disconnected')
      store.wsConnected = false
      store.isThinking = false
      clearStableTimer()
      stopHeartbeat()
      if (!closedByUs) scheduleReconnect()
    }

    ws.value.onerror = () => {
      ws.value?.close()
    }
  }

  function handleMessage(msg: ServerMessage) {
    const { type, data, request_id } = msg

    switch (type) {
      case 'output:text:delta':
        store.isThinking = false
        chatStore.appendChatText(data.delta, request_id || data.request_id || '')
        break

      case 'output:text:done':
        store.isThinking = false
        chatStore.finishChatStream(request_id || data.request_id || '')
        if (data.error) console.warn('[Deskpet] Reply failed:', data.error)
        break

      case 'output:text':
        store.isThinking = false
        chatStore.showChatMessage(data.text)
        break

      case 'state:emotion':
        // 接受内置词表 + 当前模型声明的自定义情绪
        if (isDeskpetEmotionValue(data.emotion) || store.modelEmotions.includes(data.emotion)) {
          // 同值赋值不会触发 watch，pulse 保证相同情绪连发也能重放并刷新回退窗口
          store.currentEmotion = data.emotion
          store.emotionPulse++
        } else {
          console.debug('[Deskpet] Ignore unknown emotion:', data.emotion)
        }
        break

      case 'state:animation':
        store.pendingAnimation = data.name
        store.pendingAnimationLoop = !!data.loop
        break

      case 'output:audio':
        if (data.base64) playAudio(data.base64)
        break

      case 'state:thinking':
        store.isThinking = true
        break

      case 'output:emoji':
        store.isThinking = false
        if (data.base64) chatStore.addEmojiMessage(data.base64, data.description || '')
        break

      case 'sys:env':
        // 插件上报 MaiBot 的 Python 解释器路径：桥进程复用同一环境，无需单独装 Python
        if (typeof data.python === 'string' && data.python) {
          void window.electronAPI?.setDetectedPython(data.python)
        }
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

  function sendScreenshot(base64: string) {
    return send('input:screenshot', { image: base64 })
  }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer.value = setInterval(() => {
      // 睡眠唤醒/NAT 掉线后 TCP 半开，socket 仍显示 OPEN 但收不到任何东西；
      // 服务端会回显心跳，超时没有任何入站消息就主动断开触发重连
      if (lastActivity && Date.now() - lastActivity > LIVENESS_TIMEOUT_MS) {
        console.warn('[Deskpet] No server activity, forcing reconnect')
        ws.value?.close()
        return
      }
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
    closedByUs = true
    clearStableTimer()
    stopHeartbeat()
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value)
      reconnectTimer.value = null
    }
    stopAllAudio()
    ws.value?.close()
    ws.value = null
  }

  onMounted(() => {
    connect()
  })

  onUnmounted(() => {
    disconnect()
  })

  return { ws, connect, disconnect, send, sendScreenshot }
}

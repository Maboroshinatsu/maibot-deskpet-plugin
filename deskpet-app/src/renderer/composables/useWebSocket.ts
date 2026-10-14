import { ref, onMounted, onUnmounted } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'
import { useChatStore } from '@/stores/chat'
import { useLipSync } from './useLipSync'
import { findModelStatePreset, isDeskpetEmotionValue } from '@/services/live2d/emotion-adapter'
import { DEFAULT_WS_URL, type ServerMessage } from '@/services/protocol'
import { normalizeServerMessage } from '@/services/host/maibot-protocol'
import { applyHostEvent, type DeskpetEventDeps } from '@/services/host/event-controller'

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
  let activeUrl = getWsUrl()
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
    startLipSync(audio)
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
    const currentUrl = getWsUrl()
    const currentToken = getWsToken()
    activeUrl = currentUrl

    try {
      ws.value = new WebSocket(currentUrl)
    } catch {
      console.warn('[Deskpet] WebSocket connect failed, retrying...')
      scheduleReconnect()
      return
    }

    const socket = ws.value
    socket.onopen = () => {
      if (ws.value !== socket) return
      console.log('[Deskpet] WebSocket connected')
      store.wsConnected = true
      if (currentToken) send('auth', { token: currentToken })
      // 重连后插件端的 _model_emotions / _model_controls 可能已丢失或过时，补发当前模型能力
      if ((store.modelEmotions?.length ?? 0) > 0) {
        send('sys:emotions', { emotions: store.modelEmotions })
      }
      if ((store.modelControls?.length ?? 0) > 0 || (store.statePresets?.length ?? 0) > 0) {
        send('sys:controls', {
          controls: (store.modelControls ?? []).map((c) => ({
            id: c.id,
            label: c.label,
            category: c.category,
            active: c.active,
          })),
          presets: (store.statePresets ?? []).map((p) => ({
            id: p.id,
            label: p.label,
            description: p.description,
            emotion: p.emotion,
            group: p.group,
            controls: p.controls,
            parameters: p.parameters,
            custom: true,
          })),
        })
      }
      lastActivity = Date.now()
      clearStableTimer()
      stableTimer = setTimeout(() => {
        stableTimer = null
        reconnectAttempt.value = 0
      }, STABLE_AFTER_MS)
      startHeartbeat()
    }

    socket.onmessage = (event) => {
      if (ws.value !== socket) return
      lastActivity = Date.now()
      try {
        handleMessage(JSON.parse(event.data) as ServerMessage)
      } catch (e) {
        console.warn('[Deskpet] Failed to parse message:', e)
      }
    }

    socket.onclose = () => {
      if (ws.value !== socket) return
      void window.electronAPI?.clearDetectedPython().catch(() => {})
      console.log('[Deskpet] WebSocket disconnected')
      store.wsConnected = false
      store.isThinking = false
      clearStableTimer()
      stopHeartbeat()
      if (!closedByUs) scheduleReconnect()
    }

    socket.onerror = () => {
      if (ws.value === socket) socket.close()
    }
  }

  /**
   * DP-017：协议归一化与事件应用已移到 services/host/。
   * 本函数只做“链路 → 归一化 → 控制器”的编排，不再内联宿主协议分支。
   */
  const eventDeps: DeskpetEventDeps = {
    isKnownEmotion: (emotion) =>
      isDeskpetEmotionValue(emotion) ||
      store.modelEmotions.includes(emotion) ||
      !!findModelStatePreset(store.statePresets ?? [], emotion),
    setEmotion: (emotion) => {
      const preset = findModelStatePreset(store.statePresets ?? [], emotion)
      if (preset && store.live2dModel) {
        store.applyControlAction(preset.id, 'preset')
        return
      }
      // 同值赋值不会触发 watch，pulse 保证相同情绪连发也能重放并刷新回退窗口
      store.currentEmotion = emotion
      store.emotionPulse++
    },
    playAnimation: (name, loop) => {
      store.pendingAnimation = name
      store.pendingAnimationLoop = loop
    },
    setControl: (control, action) => {
      store.applyControlAction(control, action)
    },
    appendReplyDelta: (delta, requestId) => { chatStore.appendChatText(delta, requestId) },
    finishReply: (requestId, error) => { chatStore.finishChatStream(requestId, error) },
    speakReply: (text) => { void speakReply(text) },
    showReplyText: (text) => { chatStore.showChatMessage(text) },
    playAudio,
    addEmoji: (base64, description) => { chatStore.addEmojiMessage(base64, description) },
    setThinking: (active) => { store.isThinking = active },
    offerRuntimeCandidate: (python) => {
      // 来源取当前连接真实配置 URL，不接受帧内伪造的来源
      void window.electronAPI?.setDetectedPython(python, activeUrl).catch(() => {})
    },
    log: (message, ...args) => { console.log(message, ...args) },
    warn: (message, ...args) => { console.warn(message, ...args) },
    debug: (message, ...args) => { console.debug(message, ...args) },
  }

  function handleMessage(msg: ServerMessage) {
    const event = normalizeServerMessage(msg)
    if (!event) return
    applyHostEvent(event, eventDeps)
  }

  function send(type: string, data: Record<string, any> = {}) {
    if (ws.value?.readyState !== WebSocket.OPEN) return false
    ws.value.send(JSON.stringify({ type, data, timestamp: Date.now() }))
    return true
  }

  /** 收到完整回复文本后，调本机 TTS 桥合成并播放（跨机部署时合成在客户端完成） */
  async function speakReply(text: string) {
    const api = window.electronAPI
    if (!api?.ttsSynthesize) return
    try {
      const b64 = await api.ttsSynthesize(text)
      if (b64) playAudio(b64)
    } catch (err) {
      console.warn('[Deskpet] TTS synthesize failed:', err)
    }
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
    void window.electronAPI?.clearDetectedPython().catch(() => {})
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

  function reconnectWithNewConfig() {
    reconnectAttempt.value = 0
    disconnect()
    connect()
  }

  onMounted(() => {
    connect()
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('deskpet:ws-config-changed', reconnectWithNewConfig)
    }
  })

  onUnmounted(() => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('deskpet:ws-config-changed', reconnectWithNewConfig)
    }
    disconnect()
  })

  return { ws, connect, disconnect, send, sendScreenshot }
}

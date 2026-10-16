import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

/** 聊天记录上限，超出后丢弃最旧的消息，避免长时间挂机内存持续增长 */
const MAX_MESSAGES = 200

/** 落盘防抖：流式回复会高频追加，避免每条都写盘 */
const PERSIST_DEBOUNCE_MS = 800

/** 从磁盘读回的消息可能是旧版本或损坏的，逐条做最小校验并复位瞬态字段 */
function sanitizeLoadedMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const type = m.type
  const role = m.role
  const id = typeof m.id === 'string' ? m.id : null
  const timestamp = typeof m.timestamp === 'number' ? m.timestamp : Date.now()
  if (!id) return null
  if (type === 'text' && (role === 'user' || role === 'assistant') && typeof m.text === 'string') {
    return {
      id,
      role,
      text: m.text,
      // 上次退出时可能正处在流式中：复位为已完成，否则气泡会一直显示「正在输入」
      streaming: false,
      timestamp,
      type: 'text',
      restored: true,
      ...(typeof m.requestId === 'string' ? { requestId: m.requestId } : {}),
    }
  }
  if (type === 'emoji' && role === 'assistant' && typeof m.base64 === 'string') {
    return {
      id,
      role: 'assistant',
      base64: m.base64,
      description: typeof m.description === 'string' ? m.description : '',
      timestamp,
      type: 'emoji',
      restored: true,
    }
  }
  return null
}

export interface TextMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  timestamp: number
  type: 'text'
  /** 流式分组用；只在 streaming 中的消息上匹配，后端缺 request_id 时不会把所有回复并进一条 */
  requestId?: string
  /** 从磁盘恢复的历史消息：只在消息记录面板里展示，不参与启动时的气泡弹出 */
  restored?: boolean
}

export interface EmojiMessage {
  id: string
  role: 'assistant'
  base64: string
  description: string
  timestamp: number
  type: 'emoji'
  /** 从磁盘恢复的历史消息：只在消息记录面板里展示，不参与启动时的气泡弹出 */
  restored?: boolean
}

export type ChatMessage = TextMessage | EmojiMessage

let idSeq = 0
/** Date.now() 同毫秒内会碰撞（连发表情包、快速输入），补个单调序号保证 :key 唯一 */
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++idSeq}`
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const botName = ref<string>('MaiBot')
  try {
    const cachedName = localStorage.getItem('deskpet/bot-name')
    if (cachedName && cachedName.trim()) botName.value = cachedName.trim()
  } catch {}

  function setBotName(name: string) {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    botName.value = trimmed
    try {
      localStorage.setItem('deskpet/bot-name', trimmed)
    } catch {}
  }

  let hydrated = false
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  function persistNow(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    const api = window.electronAPI
    if (!api?.saveChatHistory) return Promise.resolve()
    // 只存必要字段，避免把瞬态状态写进磁盘
    const payload = messages.value.map((m) =>
      m.type === 'emoji'
        ? { id: m.id, role: m.role, base64: m.base64, description: m.description, timestamp: m.timestamp, type: m.type }
        : { id: m.id, role: m.role, text: m.text, streaming: false, timestamp: m.timestamp, type: m.type, ...(m.requestId ? { requestId: m.requestId } : {}) },
    )
    // 返回 Promise：退出前握手需要 await 到真正写完，而不是只把 IPC 发出去
    return api.saveChatHistory(payload).then(() => {}).catch(() => {})
  }

  /**
   * 立即落盘并等待写入完成。
   *
   * 退出时由主进程握手调用：800ms 防抖窗口内直接关窗会丢掉最后一条消息，
   * 而 saveChatHistory 是异步 IPC，窗口卸载后不保证送达，所以必须由主进程
   * 阻塞关闭流程、等这里回执后再真正退出。
   */
  function flush(): Promise<void> {
    if (!hydrated) return Promise.resolve()
    return persistNow()
  }

  function schedulePersist() {
    if (!hydrated) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS)
  }

  /** 启动时从磁盘恢复聊天记录（不存在或损坏则保持为空） */
  async function hydrate() {
    if (hydrated) return
    try {
      const raw = (await window.electronAPI?.loadChatHistory?.()) ?? []
      const restored = raw.map(sanitizeLoadedMessage).filter((m): m is ChatMessage => m !== null)
      if (restored.length > 0) messages.value = restored.slice(-MAX_MESSAGES)
    } catch {
      // 读取失败不影响启动
    } finally {
      hydrated = true
      watch(messages, schedulePersist, { deep: true })
    }
  }

  // 首次实例化即开始恢复；后续调用是空操作
  void hydrate()

  // backward-compat: last assistant bubble
  // 只认本次会话产生的回复：磁盘里恢复出来的历史消息不该在启动瞬间弹成气泡
  const chatBubble = computed(() => {
    const last = [...messages.value].reverse().find((m) => m.role === 'assistant' && !m.restored)
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

  function finishChatStream(requestId: string, error?: string) {
    const msg = findStreamingMessage(requestId)
    if (msg) {
      msg.streaming = false
      if (error) {
        msg.text = msg.text.trim()
          ? `${msg.text}\n（回复中断：${error}）`
          : `（回复失败：${error}）`
      }
    } else if (error) {
      showChatMessage(`（回复失败：${error}）`)
    }
    // 回复结束正是用户最可能立刻关窗的时刻：立即落盘一次，不依赖退出握手兜底
    void flush()
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
    void persistNow()
  }

  return {
    messages,
    chatBubble,
    botName,
    setBotName,
    addUserMessage,
    addEmojiMessage,
    appendChatText,
    finishChatStream,
    showChatMessage,
    clear,
    hydrate,
    flush,
  }
})

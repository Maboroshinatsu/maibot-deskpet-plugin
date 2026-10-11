/**
 * FakeHost（DP-017）。
 *
 * 一个不依赖 WebSocket / MaiBot / Python / Electron 的宿主适配器实现，
 * 用于：1) 单测里驱动前端；2) 演示“换宿主不改 Core”。
 *
 * 它只做三件事：记录反向命令、按需发出归一化事件、声明能力。
 */
import {
  NO_CAPABILITIES,
  type DeskpetHostEvent,
  type HostAdapter,
  type HostCapabilities,
  type HostConnectionState,
  type HostEventListener,
} from './contracts'

export interface FakeHostOptions {
  capabilities?: Partial<HostCapabilities>
  /** 反向命令是否“成功”（用于测试不支持时的降级） */
  acceptsInput?: boolean
}

export interface FakeHostRecord {
  userText: string[]
  screenshots: string[]
  modelEmotions: string[][]
}

export interface FakeHost extends HostAdapter {
  /** 记录所有反向命令，供断言 */
  readonly record: FakeHostRecord
  /** 手动发出一个归一化事件（模拟宿主推送） */
  emit(event: DeskpetHostEvent): void
  /** 模拟连接建立/断开 */
  setConnectionState(state: HostConnectionState): void
}

export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
  const capabilities: HostCapabilities = { ...NO_CAPABILITIES, ...(options.capabilities ?? {}) }
  const acceptsInput = options.acceptsInput ?? true
  const listeners = new Set<HostEventListener>()
  const record: FakeHostRecord = { userText: [], screenshots: [], modelEmotions: [] }
  let state: HostConnectionState = 'disconnected'

  function emit(event: DeskpetHostEvent): void {
    for (const listener of [...listeners]) listener(event)
  }

  function setConnectionState(next: HostConnectionState): void {
    state = next
    emit({ kind: 'connection', state: next })
  }

  return {
    id: 'fake',
    record,
    emit,
    setConnectionState,

    connect() { setConnectionState('connecting'); setConnectionState('connected') },
    disconnect() { setConnectionState('disconnected') },
    getConnectionState: () => state,
    getCapabilities: () => ({ ...capabilities }),

    subscribe(listener: HostEventListener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    sendUserText(text: string) {
      if (!capabilities.sendInput || !acceptsInput) return false
      record.userText.push(text)
      return true
    },
    sendScreenshot(base64: string) {
      if (!acceptsInput) return false
      record.screenshots.push(base64)
      return true
    },
    sendModelEmotions(emotions: string[]) {
      if (!acceptsInput) return false
      record.modelEmotions.push([...emotions])
      return true
    },

    dispose() {
      listeners.clear()
      state = 'disconnected'
    },
  }
}

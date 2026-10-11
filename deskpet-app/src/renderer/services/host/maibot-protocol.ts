/**
 * MaiBot 协议 → 归一化事件（DP-017）。
 *
 * 这是**唯一**允许了解 MaiBot 消息类型的地方。它刻意不 import Vue / Pinia /
 * Electron / DOM：只做纯函数转换，便于单测，也便于将来把 MaiBot 换成别的宿主。
 */
import type { ServerMessage } from '../protocol'
import type { DeskpetHostEvent } from './contracts'

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function pickRequestId(msg: ServerMessage, data: Record<string, unknown>): string {
  return asString(msg.request_id) || asString(data.request_id)
}

/**
 * 把一条原始宿主消息翻译成归一化事件。
 *
 * 返回 null 表示该消息不需要产生任何事件（例如心跳）。
 * 未知类型返回 unknown 事件：调用方只应记录，不得据此执行动作。
 */
export function normalizeServerMessage(msg: ServerMessage): DeskpetHostEvent | null {
  const type = asString(msg.type)
  const data = (msg.data ?? {}) as Record<string, unknown>

  switch (type) {
    case 'output:text:delta':
      return { kind: 'reply-delta', delta: asString(data.delta), requestId: pickRequestId(msg, data) }

    case 'output:text:done': {
      const error = asString(data.error)
      return {
        kind: 'reply-done',
        requestId: pickRequestId(msg, data),
        ...(error ? { error } : {}),
      }
    }

    case 'output:text':
      return { kind: 'reply-text', text: asString(data.text) }

    case 'state:emotion':
      return { kind: 'emotion', emotion: asString(data.emotion) }

    case 'state:animation':
      return { kind: 'animation', name: asString(data.name), loop: !!data.loop }

    case 'output:audio':
      return { kind: 'audio', base64: asString(data.base64) }

    case 'state:thinking':
      return { kind: 'thinking', active: true }

    case 'output:emoji':
      return {
        kind: 'emoji',
        base64: asString(data.base64),
        description: asString(data.description),
      }

    case 'sys:env':
      return { kind: 'runtime-candidate', python: asString(data.python), sourceUrl: '' }

    case 'heartbeat':
      return null

    default:
      return { kind: 'unknown', type, data }
  }
}

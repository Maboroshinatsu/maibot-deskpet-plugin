/**
 * MaiBot 协议 → 归一化事件（DP-017）。
 *
 * 这是**唯一**允许了解 MaiBot 消息类型的地方。它刻意不 import Vue / Pinia /
 * Electron / DOM：只做纯函数转换，便于单测，也便于将来把 MaiBot 换成别的宿主。
 */
import type { ServerMessage } from '../protocol'
import type { DeskpetControlAction, DeskpetHostEvent } from './contracts'

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asControlAction(value: unknown): DeskpetControlAction {
  if (
    value === 'on' ||
    value === 'off' ||
    value === 'toggle' ||
    value === 'reset' ||
    value === 'reset_transient' ||
    value === 'set' ||
    value === 'preset'
  ) {
    return value
  }
  return 'toggle'
}

function asControlsString(control: unknown, controls: unknown): string {
  if (typeof control === 'string' && control.trim()) return control.trim()
  if (Array.isArray(controls)) {
    return controls
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((s) => s.trim())
      .join(', ')
  }
  if (typeof controls === 'string' && controls.trim()) return controls.trim()
  return typeof control === 'string' ? control : ''
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
      const text = asString(data.text)
      const speak = typeof data.speak === 'boolean' ? data.speak : undefined
      const style = asString(data.tts_style) || asString(data.style)
      return {
        kind: 'reply-done',
        requestId: pickRequestId(msg, data),
        ...(error ? { error } : {}),
        ...(text ? { text } : {}),
        ...(speak !== undefined ? { speak } : {}),
        ...(style ? { style } : {}),
      }
    }

    case 'output:text':
      return { kind: 'reply-text', text: asString(data.text) }

    case 'state:emotion': {
      const controls = asControlsString(undefined, data.controls)
      return {
        kind: 'emotion',
        emotion: asString(data.emotion),
        ...(controls ? { controls } : {}),
      }
    }

    case 'state:animation':
      return { kind: 'animation', name: asString(data.name), loop: !!data.loop }

    case 'state:control': {
      const emotion = asString(data.emotion)
      return {
        kind: 'control',
        control: asControlsString(data.control, data.controls),
        action: asControlAction(data.action),
        ...(emotion ? { emotion } : {}),
      }
    }

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

    case 'sys:env': {
      const botName = asString(data.bot_name)
      return {
        kind: 'runtime-candidate',
        python: asString(data.python),
        sourceUrl: '',
        ...(botName ? { botName } : {}),
      }
    }

    case 'debug:screenshot':
      return { kind: 'debug-screenshot', ...(asString(data.path) ? { path: asString(data.path) } : {}) }

    case 'heartbeat':
      return null

    default:
      return { kind: 'unknown', type, data }
  }
}

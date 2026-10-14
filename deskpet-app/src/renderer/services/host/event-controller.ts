/**
 * 事件控制器（DP-017）。
 *
 * 职责：把归一化事件应用到 UI/媒体，**不关心事件来自哪个宿主**。
 * 所有副作用通过注入的 deps 完成，因此本文件不 import Vue / Pinia / Electron / DOM，
 * 可以用纯对象替身直接测试（见 tests/host-controller.test.cjs）。
 */
import type { DeskpetControlAction, DeskpetHostEvent } from './contracts'

export interface DeskpetEventDeps {
  /** 是否认识这个情绪：内置词表 ∪ 当前模型声明 */
  isKnownEmotion(emotion: string): boolean
  setEmotion(emotion: string): void
  playAnimation(name: string, loop: boolean): void
  setControl?(control: string, action: DeskpetControlAction): void
  appendReplyDelta(delta: string, requestId: string): void
  finishReply(requestId: string, error?: string): void
  /** 用完整回复文本 + requestId 触发端侧语音合成与播放（可选：平台不支持时省略） */
  speakReply?(text: string, requestId: string): void
  showReplyText(text: string): void
  playAudio(base64: string): void
  addEmoji(base64: string, description: string): void
  setThinking(active: boolean): void
  /** 宿主上报的本机运行时候选（仅候选，授权由平台层负责） */
  offerRuntimeCandidate(python: string): void
  log(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

/**
 * 应用一个归一化事件。
 * 返回值表示该事件是否被处理（unknown/被忽略时为 false），便于调用方统计与诊断。
 */
export function applyHostEvent(event: DeskpetHostEvent, deps: DeskpetEventDeps): boolean {
  switch (event.kind) {
    case 'connection':
      // 连接状态由传输层直接维护，控制器不重复处理
      return false

    case 'reply-delta':
      deps.setThinking(false)
      deps.appendReplyDelta(event.delta, event.requestId)
      return true

    case 'reply-done':
      deps.setThinking(false)
      deps.finishReply(event.requestId, event.error)
      if (event.error) deps.warn('[Deskpet] Reply failed:', event.error)
      // 端侧语音合成：宿主只给完整文本与朗读意图，合成与播放由平台层在本机完成
      else if (event.text && event.speak !== false) deps.speakReply?.(event.text, event.requestId)
      return true

    case 'reply-text':
      deps.setThinking(false)
      deps.showReplyText(event.text)
      return true

    case 'emotion':
      // 内置词表 + 当前模型声明的自定义情绪
      if (deps.isKnownEmotion(event.emotion)) {
        deps.setEmotion(event.emotion)
      } else {
        deps.debug('[Deskpet] Ignore unknown emotion:', event.emotion)
      }
      if (event.controls) {
        deps.setControl?.(event.controls, 'set')
      }
      return true

    case 'animation':
      deps.playAnimation(event.name, event.loop)
      return true

    case 'control':
      deps.setControl?.(event.control, event.action)
      if (event.action !== 'preset' && event.emotion && deps.isKnownEmotion(event.emotion)) {
        deps.setEmotion(event.emotion)
      }
      return true

    case 'audio':
      if (event.base64) deps.playAudio(event.base64)
      return true

    case 'thinking':
      deps.setThinking(event.active)
      return true

    case 'emoji':
      deps.setThinking(false)
      if (event.base64) deps.addEmoji(event.base64, event.description)
      return true

    case 'runtime-candidate':
      // 空路径不构成候选；非空才上送平台层做校验与人工确认
      if (event.python) deps.offerRuntimeCandidate(event.python)
      return true

    case 'heartbeat':
      // 心跳只用于连接存活判定，无 UI 副作用
      return false

    case 'unknown':
      deps.log('[Deskpet] Unknown message type:', event.type, event.data)
      return false

    default:
      return false
  }
}

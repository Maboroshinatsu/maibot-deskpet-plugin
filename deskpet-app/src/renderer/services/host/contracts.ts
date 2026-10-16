/**
 * 宿主接入契约（DP-017）。
 *
 * 本文件是“宿主无关”的边界定义，刻意不 import Vue / Pinia / Electron / DOM / Node fs。
 * 目的：让不同 Agent 宿主（MaiBot、Codex、Harness、Fake）只实现同一组接口，
 * 而 Core 与 UI 不感知具体宿主。
 */

/** 连接状态（宿主无关，不含任何 WebSocket 细节） */
export type HostConnectionState = 'disconnected' | 'connecting' | 'connected'

/** 宿主声明的能力。UI 只根据能力决定展示什么，不去猜宿主类型。 */
export interface HostCapabilities {
  /** 能推送任务状态（工作中/等待/失败/完成） */
  statusEvents: boolean
  /** 能提供助手可见文本 */
  assistantText: boolean
  /** 能把用户输入送回宿主会话 */
  sendInput: boolean
  /** 能取消进行中的轮次 */
  cancelTurn: boolean
  /** 能接收角色类指令（表情/动作/通知） */
  characterTools: boolean
  /** 能选择/绑定具体会话 */
  sessionSelection: boolean
}

export const NO_CAPABILITIES: HostCapabilities = {
  statusEvents: false,
  assistantText: false,
  sendInput: false,
  cancelTurn: false,
  characterTools: false,
  sessionSelection: false,
}

export type DeskpetControlAction = 'on' | 'off' | 'toggle' | 'reset' | 'reset_transient' | 'set' | 'preset'

export interface ModelControlSummary {
  id: string
  label: string
  category: string
  active: boolean
}

export interface ModelControlPresetSummary {
  id: string
  label: string
  controls: string[]
  emotion: string
  group?: string
  description: string
  parameters?: Record<string, number>
  custom?: boolean
}

/**
 * 归一化事件：所有宿主都必须翻译成这组事件，UI 只消费它们。
 * 这是 DP-017 要求的“宿主事件归一化”落点。
 */
export type DeskpetHostEvent =
  | { kind: 'connection'; state: HostConnectionState }
  /** 助手文本增量 */
  | { kind: 'reply-delta'; delta: string; requestId: string }
  /** 一次回复结束；error 存在表示失败。text 为完整回复文本，speak 表示是否应朗读（端侧合成用），style 为语音风格提示词 */
  | { kind: 'reply-done'; requestId: string; error?: string; text?: string; speak?: boolean; style?: string }
  /** 一次性完整文本（非流式） */
  | { kind: 'reply-text'; text: string }
  | { kind: 'emotion'; emotion: string; controls?: string }
  | { kind: 'animation'; name: string; loop: boolean }
  | { kind: 'control'; control: string; action: DeskpetControlAction; emotion?: string }
  | { kind: 'audio'; base64: string }
  | { kind: 'thinking'; active: boolean }
  | { kind: 'emoji'; base64: string; description: string }
  /** 宿主上报的本机运行时候选（仅候选，不代表已授权）与环境信息 */
  | { kind: 'runtime-candidate'; python: string; sourceUrl: string; botName?: string }
  | { kind: 'debug-screenshot'; path?: string }
  | { kind: 'heartbeat' }
  /** 未识别消息：保留原始内容以便诊断，但不得据此执行任何动作 */
  | { kind: 'unknown'; type: string; data: Record<string, unknown> }

/** 订阅回调 */
export type HostEventListener = (event: DeskpetHostEvent) => void

/**
 * 宿主适配器：连接 + 声明能力 + 事件订阅 + 允许的反向命令。
 * 不负责角色渲染、窗口行为、音频播放或任意文件访问。
 */
export interface HostAdapter {
  /** 稳定标识，用于日志与去重（例如 'maibot'、'codex'、'fake'） */
  readonly id: string
  connect(): void
  disconnect(): void
  getConnectionState(): HostConnectionState
  getCapabilities(): HostCapabilities
  /** 订阅归一化事件；返回取消订阅函数 */
  subscribe(listener: HostEventListener): () => void
  /** 以下反向命令在不支持时应返回 false，而不是静默丢弃 */
  sendUserText(text: string): boolean
  sendScreenshot(base64: string): boolean
  sendModelEmotions(emotions: string[]): boolean
  sendModelControls?(controls: ModelControlSummary[], presets?: ModelControlPresetSummary[]): boolean
  dispose(): void
}

import type { ModelControlPresetSummary, ModelControlSummary } from '@/services/host/contracts'

export interface DeskpetTransport {
  sendUserText: (text: string) => boolean
  sendScreenshot: (base64: string) => boolean
  sendHeartbeat: () => boolean
  /** 上报当前模型声明的情绪键（自定义情绪对插件可见的入口） */
  sendModelEmotions: (emotions: string[]) => boolean
  /** 上报当前模型的控件列表及命名组合预设（供 AI 理解并调用预设或控件） */
  sendModelControls: (controls: ModelControlSummary[], presets?: ModelControlPresetSummary[]) => boolean
  connect: () => void
  disconnect: () => void
}

export interface RawTransportMessage {
  type: string
  data: Record<string, any>
  timestamp?: number
  request_id?: string
}

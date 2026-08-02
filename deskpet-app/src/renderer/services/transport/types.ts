export interface DeskpetTransport {
  sendUserText: (text: string) => boolean
  sendScreenshot: (base64: string) => boolean
  sendHeartbeat: () => boolean
  /** 上报当前模型声明的情绪键（自定义情绪对插件可见的入口） */
  sendModelEmotions: (emotions: string[]) => boolean
  connect: () => void
  disconnect: () => void
}

export interface RawTransportMessage {
  type: string
  data: Record<string, any>
  timestamp?: number
  request_id?: string
}

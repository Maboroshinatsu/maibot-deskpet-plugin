/** 桌宠 ↔ MaiBot 插件的 WebSocket 协议定义（与 plugin.py 保持一致） */

export const DEFAULT_WS_URL = 'ws://127.0.0.1:8523/ws'

export type ClientMessageType = 'auth' | 'input:text' | 'input:click' | 'input:screenshot' | 'heartbeat'

export interface ClientMessage {
  type: ClientMessageType
  data: Record<string, any>
  timestamp?: number
}

export interface ServerMessage {
  type: string
  data: Record<string, any>
  timestamp?: number
  request_id?: string
}

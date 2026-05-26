export const WS_URL = 'ws://127.0.0.1:8523/ws'

export interface ClientMessage {
  type: 'input:text' | 'input:click' | 'input:screenshot' | 'heartbeat'
  data: Record<string, any>
  timestamp?: number
}

export interface ServerMessage {
  type: string
  data: Record<string, any>
  timestamp?: number
  request_id?: string
}

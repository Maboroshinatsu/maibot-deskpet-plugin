export const WS_URL = 'ws://127.0.0.1:8523/ws'

export interface ClientMessage {
  type: 'input:text' | 'input:click' | 'heartbeat'
  data: Record<string, any>
  timestamp?: number
}

export interface ServerMessage {
  type: string
  data: Record<string, any>
  timestamp?: number
  request_id?: string
}

export const EMOTION_TO_MOTION: Record<string, string> = {
  happy: 'Happy',
  sad: 'Sad',
  angry: 'Angry',
  surprise: 'Surprise',
  thinking: 'Think',
  shy: 'Awkward',
  curious: 'Curious',
  neutral: 'Idle',
  idle: 'Idle'
}

export const EMOTION_LIST = Object.keys(EMOTION_TO_MOTION)

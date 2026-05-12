export interface DeskpetTransport {
  sendUserText: (text: string) => boolean
  sendHeartbeat: () => boolean
  connect: () => void
  disconnect: () => void
}

export interface RawTransportMessage {
  type: string
  data: Record<string, any>
  timestamp?: number
  request_id?: string
}

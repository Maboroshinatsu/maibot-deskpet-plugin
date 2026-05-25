import { useWebSocket } from '@/composables/useWebSocket'
import type { DeskpetTransport } from './types'

export function useChimeraTransport(): DeskpetTransport {
  const { connect, disconnect, send, sendScreenshot: wsSendScreenshot } = useWebSocket()

  return {
    connect,
    disconnect,
    sendHeartbeat: () => send('heartbeat'),
    sendUserText: (text: string) => send('input:text', { text }),
    sendScreenshot: (base64: string) => wsSendScreenshot(base64),
  }
}

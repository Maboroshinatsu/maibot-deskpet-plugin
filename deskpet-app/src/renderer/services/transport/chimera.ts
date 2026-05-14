import { useWebSocket } from '@/composables/useWebSocket'
import type { DeskpetTransport } from './types'

export function useChimeraTransport(): DeskpetTransport {
  const { connect, disconnect, send } = useWebSocket()

  return {
    connect,
    disconnect,
    sendHeartbeat: () => send('heartbeat'),
    sendUserText: (text: string) => send('input:text', { text }),
  }
}

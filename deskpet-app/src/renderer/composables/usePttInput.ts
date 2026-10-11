/** PTT ownership and cancellation, independent of Vue and microphone implementation. */
interface PttOptions {
  start: () => Promise<boolean>
  stop: () => Promise<string | null>
  cancel: () => void
  hasCapture?: () => boolean
  isRecording: () => boolean
  isVadEnabled: () => boolean
  getMode: () => 'ptt' | 'toggle'
  onText: (text: string) => void
  onError: (error: unknown) => void
}

export function createPttController(options: PttOptions) {
  let held = false
  let ownsRecording = false
  let stopping = false
  let epoch = 0
  let captureMode: 'ptt' | 'toggle' | null = null

  function cancel(): void {
    epoch++
    held = false
    captureMode = null
    if (ownsRecording) options.cancel()
    ownsRecording = false
  }

  async function finish(): Promise<void> {
    const token = epoch
    ownsRecording = false
    captureMode = null
    stopping = true
    try {
      const text = await options.stop()
      if (token === epoch && text) options.onText(text)
    } catch (err) {
      options.onError(err)
    } finally {
      stopping = false
    }
  }

  async function onDown(): Promise<void> {
    if (ownsRecording && options.hasCapture && !options.hasCapture()) {
      ownsRecording = false
      held = false
      captureMode = null
    }
    if (options.isVadEnabled() || held || stopping) return
    if (ownsRecording) {
      if (captureMode === 'toggle' && options.isRecording()) {
        held = true
        await finish()
      }
      return
    }
    if (options.isRecording()) return // 不接管手动录音。
    held = true
    ownsRecording = true
    captureMode = options.getMode()
    const token = epoch
    try {
      const accepted = await options.start()
      if (!accepted && token === epoch) {
        held = false
        ownsRecording = false
        captureMode = null
      }
    } catch (err) {
      if (token === epoch) cancel()
      options.onError(err)
    }
  }

  async function onUp(): Promise<void> {
    held = false
    if (captureMode !== 'ptt' || !ownsRecording) return
    if (!options.isRecording()) {
      cancel() // 授权尚未完成就松开，取消晚到的采集而不是留下持续录音。
      return
    }
    await finish()
  }

  return { onDown, onUp, cancel }
}

import type { TTSBackend } from './types'
import { createPiperBackend } from './backend-piper'
import { createBrowserTtsBackend } from './backend-browser'

export function createTtsBackend(): TTSBackend {
  const piper = createPiperBackend()
  const browser = createBrowserTtsBackend()

  return {
    async speak(text: string) {
      const ok = await piper.speak(text)
      if (!ok) await browser.speak(text)
      return ok
    },
    cancel() {
      piper.cancel()
      browser.cancel()
    },
    getAudioElement() {
      return piper.getAudioElement()
    },
  }
}

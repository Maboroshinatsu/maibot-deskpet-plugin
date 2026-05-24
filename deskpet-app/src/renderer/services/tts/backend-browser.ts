import type { TTSBackend } from './types'

function isAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function createBrowserTtsBackend(): TTSBackend {
  return {
    speak(text: string) {
      if (!isAvailable()) return Promise.resolve(false)
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.0
      utterance.pitch = 1.1
      return new Promise((resolve) => {
        utterance.onend = () => resolve(true)
        utterance.onerror = () => resolve(false)
        window.speechSynthesis.speak(utterance)
      })
    },
    cancel() {
      if (isAvailable()) window.speechSynthesis.cancel()
    },
    getAudioElement() { return null },
  }
}

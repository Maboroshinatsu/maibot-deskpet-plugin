import type { TTSBackend } from './types'

let currentAudio: HTMLAudioElement | null = null

export function createPiperBackend(): TTSBackend {
  return {
    async speak(text: string) {
      cancel()
      try {
        const data = await window.electronAPI?.ttsSpeak(text)
        if (!data || data.byteLength === 0) return false
        const blob = new Blob([data], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        currentAudio = audio
        return new Promise((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(true) }
          audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(false) }
          audio.play().catch(() => resolve(false))
        })
      } catch { return false }
    },
    cancel() {
      if (currentAudio) { currentAudio.pause(); currentAudio = null }
    },
    getAudioElement() { return currentAudio },
  }
}

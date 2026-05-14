let speaking = false

function isAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function useSpeechSynthesis() {
  function speak(text: string) {
    if (!isAvailable()) return

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.0
    utterance.pitch = 1.1

    utterance.onstart = () => { speaking = true }
    utterance.onend = () => { speaking = false }
    utterance.onerror = () => { speaking = false }

    window.speechSynthesis.speak(utterance)
  }

  function cancel() {
    if (!isAvailable()) return
    window.speechSynthesis.cancel()
    speaking = false
  }

  function isSpeaking(): boolean {
    return speaking
  }

  return { speak, cancel, isSpeaking }
}

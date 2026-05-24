export interface TTSBackend {
  speak(text: string): Promise<boolean>
  cancel(): void
  getAudioElement(): HTMLAudioElement | null
}

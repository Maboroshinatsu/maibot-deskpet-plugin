/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface GlobalCursorPosition {
  screenX: number
  screenY: number
  windowX: number
  windowY: number
  x: number
  y: number
}

interface ModelEntry {
  /** 展示名，取自模型文件夹名 + 文件名 */
  name: string
  /** 渲染层可直接加载的相对 URL，例如 ./models/xxx/xxx.model3.json */
  url: string
  /** live2d = .model3.json；image-set = 静态立绘包（deskpet-images.json） */
  kind: 'live2d' | 'image-set'
}

type ServiceId = 'stt-bridge' | 'tts-bridge' | 'gpt-sovits' | 'hotkey'
type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error'

interface ServiceState {
  id: ServiceId
  name: string
  port: number
  status: ServiceStatus
  pid: number | null
  detail: string
  available: boolean
  showTerminal: boolean
  autoStart: boolean
}

interface ServicesConfig {
  pythonPath: string
  gsvDir: string
  ttsRefAudio: string
  ttsPromptText: string
  pttKey: string
  autoStart: Record<ServiceId, boolean>
  showTerminal: Record<ServiceId, boolean>
}

interface ElectronAPI {
  dragWindow: (dx: number, dy: number) => Promise<void>
  setAlwaysOnTop: (flag: boolean) => Promise<void>
  setClickThroughLocked: (flag: boolean) => Promise<void>
  minimizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  onGlobalCursorPosition: (callback: (position: GlobalCursorPosition) => void) => () => void
  onResetModelView: (callback: () => void) => () => void
  onSetHoverFade: (callback: (enabled: boolean) => void) => () => void
  onScreenshotCaptured: (callback: (base64: string) => void) => () => void
  setAutoScreenshotInterval: (sec: number) => void
  sttTranscribe: (audio: ArrayBuffer, url?: string) => Promise<string | null>
  listModels: () => Promise<ModelEntry[]>
  openModelsFolder: () => Promise<string>
  reloadWindow: () => Promise<void>
  listServices: () => Promise<ServiceState[]>
  startService: (id: ServiceId) => Promise<void>
  stopService: (id: ServiceId) => Promise<void>
  restartService: (id: ServiceId) => Promise<void>
  getServiceLogs: (id: ServiceId) => Promise<string[]>
  getServicesConfig: () => Promise<ServicesConfig>
  setServicesConfig: (patch: Partial<ServicesConfig>) => Promise<ServicesConfig>
  setDetectedPython: (pythonPath: string) => Promise<void>
  onPttEvent: (callback: (state: 'down' | 'up') => void) => () => void
  onServicesUpdate: (callback: (states: ServiceState[]) => void) => () => void
  onServiceLog: (callback: (payload: { id: ServiceId; lines: string[] }) => void) => () => void
}

interface Window {
  electronAPI?: ElectronAPI
}

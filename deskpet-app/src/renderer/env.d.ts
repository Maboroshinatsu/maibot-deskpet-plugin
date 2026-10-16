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

interface WindowPlacement {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  workAreaX: number
  workAreaY: number
  workAreaWidth: number
  workAreaHeight: number
}

interface ModelEntry {
  /** 展示名，取自模型文件夹名 + 文件名 */
  name: string
  /** 渲染层可直接加载的相对 URL，例如 ./models/xxx/xxx.model3.json */
  url: string
  /** live2d = .model3.json；image-set = 静态立绘包（deskpet-images.json） */
  kind: 'live2d' | 'image-set'
}

type ServiceId = 'stt-bridge' | 'tts-bridge' | 'gpt-sovits' | 'hotkey' | 'cloud-tts'
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
  sttBackend: string
  sttApiKey: string
  sttModel: string
  sttEndpoint: string
  ttsBackend: string
  ttsApiKey: string
  ttsVoice: string
  ttsModel: string
  ttsEndpoint: string
  ttsStyle: string
  autoStart: Record<ServiceId, boolean>
  showTerminal: Record<ServiceId, boolean>
}

interface ElectronAPI {
  dragWindow: (dx: number, dy: number) => Promise<void>
  getWindowPlacement: () => Promise<WindowPlacement>
  onWindowPlacement: (callback: (placement: WindowPlacement) => void) => () => void
  setAlwaysOnTop: (flag: boolean) => Promise<void>
  setClickThroughLocked: (flag: boolean) => Promise<void>
  /** 主动读取主进程的穿透锁定 / 悬停淡化状态，用于渲染层挂载后的首次同步 */
  getUiState: () => Promise<{ clickThroughLocked: boolean; hoverFadeEnabled: boolean }>
  minimizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  onGlobalCursorPosition: (callback: (position: GlobalCursorPosition) => void) => () => void
  onResetModelView: (callback: () => void) => () => void
  onSetHoverFade: (callback: (enabled: boolean) => void) => () => void
  onSetClickThroughLocked: (callback: (locked: boolean) => void) => () => void
  onScreenshotCaptured: (callback: (base64: string) => void) => () => void
  setAutoScreenshotInterval: (sec: number) => void
  sttTranscribe: (audio: ArrayBuffer, url?: string) => Promise<string | null>
  loadChatHistory: () => Promise<unknown[]>
  saveChatHistory: (messages: unknown[]) => Promise<boolean>
  /** 主进程在放行关窗前请求渲染层立即落盘聊天记录 */
  onChatHistoryFlushRequest: (callback: () => void) => () => void
  /** 渲染层回执：防抖队列已落盘，主进程可以放行关闭 */
  notifyChatHistoryFlushed: () => void
  ttsSynthesize: (text: string, style?: string) => Promise<string | null>
  listModels: () => Promise<ModelEntry[]>
  inspectModelAssets: (modelUrl: string) => Promise<{
    cdiParameters: Record<string, { name: string; group: string }>
    cdiParts: Record<string, string>
    physicsOutputIds: string[]
    vtubeHotkeys: Record<string, string>
    expressions: Array<{
      name: string
      file: string
      parameters: Array<{ id: string; value: number; blend?: string }>
    }>
    poseGroups?: string[][]
    savedPresets?: Array<{
      id: string
      label: string
      description: string
      emotion: string
      controls: string[]
      parameters?: Record<string, number>
      steps?: Array<{
        label?: string
        durationMs: number
        holdMs: number
        controls: string[]
        parameters: Record<string, number>
      }>
      finishMode?: 'hold' | 'revert' | 'loop'
      revertHoldMs?: number
      motion?: { group: string; index?: number } | 'none'
      custom?: boolean
    }> | null
  } | null>
  saveModelPresets: (modelUrl: string, presets: unknown) => Promise<boolean>
  openModelsFolder: () => Promise<string>
  reloadWindow: () => Promise<void>
  captureDeskpetWindow: (customPath?: string) => Promise<string>
  listServices: () => Promise<ServiceState[]>
  startService: (id: ServiceId) => Promise<void>
  stopService: (id: ServiceId) => Promise<void>
  restartService: (id: ServiceId) => Promise<void>
  getServiceLogs: (id: ServiceId) => Promise<string[]>
  getServicesConfig: () => Promise<ServicesConfig>
  setServicesConfig: (patch: Partial<ServicesConfig>) => Promise<ServicesConfig>
  setDetectedPython: (pythonPath: string, sourceUrl: string) => Promise<void>
  clearDetectedPython: () => Promise<void>
  getRuntimeCandidate: () => Promise<{ id: string; pythonPath: string; sourceUrl: string } | null>
  approveDetectedPython: (id: string) => Promise<boolean>
  onPttEvent: (callback: (state: 'down' | 'up' | 'cancel') => void) => () => void
  onServicesUpdate: (callback: (states: ServiceState[]) => void) => () => void
  onServiceLog: (callback: (payload: { id: ServiceId; lines: string[] }) => void) => () => void
}

interface Window {
  electronAPI?: ElectronAPI
}

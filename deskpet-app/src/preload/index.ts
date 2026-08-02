import { contextBridge, ipcRenderer } from 'electron'

interface GlobalCursorPosition {
  screenX: number
  screenY: number
  windowX: number
  windowY: number
  x: number
  y: number
}

interface ModelEntry {
  name: string
  url: string
}

contextBridge.exposeInMainWorld('electronAPI', {
  dragWindow: (dx: number, dy: number) => ipcRenderer.invoke('drag-window', { dx, dy }),
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('set-always-on-top', flag),
  setClickThroughLocked: (flag: boolean) => ipcRenderer.invoke('set-click-through-locked', flag),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  onGlobalCursorPosition: (callback: (position: GlobalCursorPosition) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, position: GlobalCursorPosition) => callback(position)
    ipcRenderer.on('global-cursor-position', listener)
    return () => ipcRenderer.removeListener('global-cursor-position', listener)
  },
  onResetModelView: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('reset-model-view', listener)
    return () => ipcRenderer.removeListener('reset-model-view', listener)
  },
  onSetHoverFade: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled)
    ipcRenderer.on('set-hover-fade', listener)
    return () => ipcRenderer.removeListener('set-hover-fade', listener)
  },
  onScreenshotCaptured: (callback: (base64: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, base64: string) => callback(base64)
    ipcRenderer.on('screenshot-captured', listener)
    return () => ipcRenderer.removeListener('screenshot-captured', listener)
  },
  setAutoScreenshotInterval: (sec: number) => ipcRenderer.invoke('set-auto-screenshot-interval', sec),
  sttTranscribe: (audio: ArrayBuffer, url?: string): Promise<string | null> => ipcRenderer.invoke('stt-transcribe', audio, url),
  listModels: (): Promise<ModelEntry[]> => ipcRenderer.invoke('list-models'),
  openModelsFolder: () => ipcRenderer.invoke('open-models-folder'),
  reloadWindow: () => ipcRenderer.invoke('reload-window'),

  // ── 后台服务管理（STT/TTS 桥、GPT-SoVITS）──
  listServices: () => ipcRenderer.invoke('services-list'),
  startService: (id: string) => ipcRenderer.invoke('service-start', id),
  stopService: (id: string) => ipcRenderer.invoke('service-stop', id),
  restartService: (id: string) => ipcRenderer.invoke('service-restart', id),
  getServiceLogs: (id: string): Promise<string[]> => ipcRenderer.invoke('service-logs', id),
  getServicesConfig: () => ipcRenderer.invoke('services-get-config'),
  setServicesConfig: (patch: unknown) => ipcRenderer.invoke('services-set-config', patch),
  setDetectedPython: (pythonPath: string) => ipcRenderer.invoke('services-set-detected-python', pythonPath),
  onPttEvent: (callback: (state: 'down' | 'up') => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: 'down' | 'up') => callback(state)
    ipcRenderer.on('ptt-event', listener)
    return () => ipcRenderer.removeListener('ptt-event', listener)
  },
  onServicesUpdate: (callback: (states: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, states: unknown) => callback(states)
    ipcRenderer.on('services-update', listener)
    return () => ipcRenderer.removeListener('services-update', listener)
  },
  onServiceLog: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('service-log', listener)
    return () => ipcRenderer.removeListener('service-log', listener)
  },
})

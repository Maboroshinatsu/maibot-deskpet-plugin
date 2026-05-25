import { contextBridge, ipcRenderer } from 'electron'

interface GlobalCursorPosition {
  screenX: number
  screenY: number
  windowX: number
  windowY: number
  x: number
  y: number
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
})

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

interface ElectronAPI {
  dragWindow: (dx: number, dy: number) => Promise<void>
  setAlwaysOnTop: (flag: boolean) => Promise<void>
  setClickThroughLocked: (flag: boolean) => Promise<void>
  minimizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  onGlobalCursorPosition: (callback: (position: GlobalCursorPosition) => void) => () => void
  onResetModelView: (callback: () => void) => () => void
  onSetHoverFade: (callback: (enabled: boolean) => void) => () => void
}

interface Window {
  electronAPI?: ElectronAPI
}

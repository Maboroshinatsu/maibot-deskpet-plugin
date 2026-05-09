/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ElectronAPI {
  dragWindow: () => void
  setAlwaysOnTop: (flag: boolean) => void
  minimizeWindow: () => void
  closeWindow: () => void
}

interface Window {
  electronAPI?: ElectronAPI
}

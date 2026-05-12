import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, globalShortcut } from 'electron'
import path from 'path'
import fs from 'fs'

app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('in-process-gpu')

const MIN_WINDOW_WIDTH = 260
const MIN_WINDOW_HEIGHT = 360
const SHORTCUTS = {
  toggleVisible: 'CommandOrControl+Alt+H',
  toggleHoverFade: 'CommandOrControl+Alt+F',
  toggleClickThrough: 'CommandOrControl+Alt+L',
}

interface WindowBoundsState {
  x: number
  y: number
  width: number
  height: number
}

interface WindowState {
  bounds: WindowBoundsState
  alwaysOnTop: boolean
  clickThroughLocked: boolean
  hoverFadeEnabled: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampWindowBounds(bounds: WindowBoundsState): WindowBoundsState {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  const minVisibleSize = 120
  const width = Math.max(bounds.width, MIN_WINDOW_WIDTH)
  const height = Math.max(bounds.height, MIN_WINDOW_HEIGHT)

  return {
    width,
    height,
    x: clamp(bounds.x, area.x + minVisibleSize - width, area.x + area.width - minVisibleSize),
    y: clamp(bounds.y, area.y + minVisibleSize - height, area.y + area.height - height),
  }
}

function getDefaultWindowBounds(width = 600, height = 800): WindowBoundsState {
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  const safeWidth = Math.min(width, area.width)
  const safeHeight = Math.min(height, area.height)
  return {
    width: safeWidth,
    height: safeHeight,
    x: area.x + area.width - safeWidth - 20,
    y: area.y + area.height - safeHeight - 20,
  }
}

function resetWindowPosition(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { width, height } = mainWindow.getBounds()
  const bounds = getDefaultWindowBounds(width, height)
  mainWindow.setBounds(bounds)
  saveWindowState()
}

function resetAllLayout(): void {
  resetWindowPosition()
  mainWindow?.webContents.send('reset-model-view')
}

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const parsed = JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf-8')) as Partial<WindowState & WindowBoundsState>
    const sourceBounds = 'bounds' in parsed && parsed.bounds ? parsed.bounds : parsed
    return {
      bounds: clampWindowBounds({
        width: typeof sourceBounds.width === 'number' ? sourceBounds.width : 600,
        height: typeof sourceBounds.height === 'number' ? sourceBounds.height : 800,
        x: typeof sourceBounds.x === 'number' ? sourceBounds.x : 100,
        y: typeof sourceBounds.y === 'number' ? sourceBounds.y : 100,
      }),
      alwaysOnTop: typeof parsed.alwaysOnTop === 'boolean' ? parsed.alwaysOnTop : true,
      clickThroughLocked: typeof parsed.clickThroughLocked === 'boolean' ? parsed.clickThroughLocked : false,
      hoverFadeEnabled: typeof parsed.hoverFadeEnabled === 'boolean' ? parsed.hoverFadeEnabled : false,
    }
  } catch {
    return { bounds: getDefaultWindowBounds(), alwaysOnTop: true, clickThroughLocked: false, hoverFadeEnabled: false }
  }
}

let enforcingWindowBounds = false

function enforceWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || enforcingWindowBounds) return
  enforcingWindowBounds = true
  try {
    const current = mainWindow.getBounds()
    const next = clampWindowBounds(current)
    if (current.x !== next.x || current.y !== next.y || current.width !== next.width || current.height !== next.height) {
      mainWindow.setBounds(next)
      lastSavedBounds = next
    }
  } finally {
    enforcingWindowBounds = false
  }
}

function saveWindowState(): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      lastSavedBounds = mainWindow.getBounds()
    }
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(getWindowStatePath(), JSON.stringify({
      bounds: lastSavedBounds,
      alwaysOnTop,
      clickThroughLocked,
      hoverFadeEnabled,
    }, null, 2), 'utf-8')
  } catch {
    // ignore window state persistence failures
  }
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let cursorPollTimer: ReturnType<typeof setInterval> | null = null
let lastCursorX: number | null = null
let lastCursorY: number | null = null
let alwaysOnTop = true
let clickThroughLocked = false
let hoverFadeEnabled = false
let lastSavedBounds: WindowBoundsState = { width: 600, height: 800, x: 100, y: 100 }

function setAlwaysOnTopState(flag: boolean): void {
  alwaysOnTop = flag
  mainWindow?.setAlwaysOnTop(flag, 'floating')
  saveWindowState()
  createTray()
}

function setClickThroughLocked(flag: boolean): void {
  clickThroughLocked = flag
  mainWindow?.setIgnoreMouseEvents(flag, { forward: true })
  saveWindowState()
  createTray()
}

function setHoverFadeEnabled(flag: boolean): void {
  hoverFadeEnabled = flag
  mainWindow?.webContents.send('set-hover-fade', flag)
  saveWindowState()
  createTray()
}

function stopGlobalCursorPolling(): void {
  if (cursorPollTimer) {
    clearInterval(cursorPollTimer)
    cursorPollTimer = null
  }
}

function startGlobalCursorPolling(): void {
  if (cursorPollTimer) return

  cursorPollTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    const cursor = screen.getCursorScreenPoint()
    if (cursor.x === lastCursorX && cursor.y === lastCursorY) return

    lastCursorX = cursor.x
    lastCursorY = cursor.y

    const bounds = mainWindow.getBounds()
    mainWindow.webContents.send('global-cursor-position', {
      screenX: cursor.x,
      screenY: cursor.y,
      windowX: bounds.x,
      windowY: bounds.y,
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y
    })
  }, 33)
}

function getAppIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../renderer/icon.png')
}

function createWindow(): void {
  const state = loadWindowState()
  const bounds = state.bounds
  lastSavedBounds = bounds
  alwaysOnTop = state.alwaysOnTop
  clickThroughLocked = state.clickThroughLocked
  hoverFadeEnabled = state.hoverFadeEnabled
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    type: 'panel',
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: getAppIconPath(),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating')
  mainWindow.setIgnoreMouseEvents(clickThroughLocked, { forward: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send('set-hover-fade', hoverFadeEnabled)
  })

  mainWindow.on('move', () => {
    enforceWindowBounds()
    saveWindowState()
  })
  mainWindow.on('resize', () => {
    enforceWindowBounds()
    saveWindowState()
  })
  mainWindow.on('close', saveWindowState)

  mainWindow.on('closed', () => {
    stopGlobalCursorPolling()
    mainWindow = null
  })

  startGlobalCursorPolling()
}

function getTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(getAppIconPath())
  return icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 })
}

function formatShortcut(accelerator: string): string {
  return accelerator.replace('CommandOrControl', 'Ctrl')
}

function toggleWindowVisible(): void {
  if (!mainWindow) return
  mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
}

function registerGlobalShortcuts(): void {
  globalShortcut.unregisterAll()

  const bindings: Array<[string, () => void]> = [
    [SHORTCUTS.toggleVisible, toggleWindowVisible],
    [SHORTCUTS.toggleHoverFade, () => setHoverFadeEnabled(!hoverFadeEnabled)],
    [SHORTCUTS.toggleClickThrough, () => setClickThroughLocked(!clickThroughLocked)],
  ]

  for (const [accelerator, callback] of bindings) {
    if (!globalShortcut.register(accelerator, callback)) {
      console.warn(`[deskpet] Global shortcut registration failed: ${accelerator}`)
    }
  }
}

function createTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }

  const lockLabel = clickThroughLocked
    ? `取消锁定穿透（当前鼠标会穿透桌宠，${formatShortcut(SHORTCUTS.toggleClickThrough)}）`
    : `锁定穿透 (${formatShortcut(SHORTCUTS.toggleClickThrough)})`
  tray = new Tray(getTrayIcon())
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `显示/隐藏 (${formatShortcut(SHORTCUTS.toggleVisible)})`, click: toggleWindowVisible },
    { label: '置顶', type: 'checkbox', checked: alwaysOnTop, click: (mi) => { setAlwaysOnTopState(mi.checked) } },
    { label: lockLabel, type: 'checkbox', checked: clickThroughLocked, click: (mi) => { setClickThroughLocked(mi.checked) } },
    { label: `悬停淡化模型 (${formatShortcut(SHORTCUTS.toggleHoverFade)})`, type: 'checkbox', checked: hoverFadeEnabled, click: (mi) => { setHoverFadeEnabled(mi.checked) } },
    { label: '重置模型位置', click: () => { mainWindow?.webContents.send('reset-model-view') } },
    { label: '重置窗口位置', click: () => { resetWindowPosition() } },
    { label: '重置全部布局', click: () => { resetAllLayout() } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit() } }
  ]))
  tray.setToolTip(clickThroughLocked ? 'MaiBot 桌面宠物（已锁定穿透，请从托盘取消）' : 'MaiBot 桌面宠物')
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  registerGlobalShortcuts()

  ipcMain.handle('drag-window', (event, { dx, dy }: { dx: number; dy: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const bounds = win.getBounds()
    const nextBounds = clampWindowBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy })
    win.setPosition(nextBounds.x, nextBounds.y)
  })

  ipcMain.handle('set-always-on-top', (_event, flag: boolean) => {
    setAlwaysOnTopState(flag)
  })

  ipcMain.handle('set-click-through-locked', (_event, flag: boolean) => {
    setClickThroughLocked(flag)
  })

  ipcMain.handle('minimize-window', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('close-window', () => {
    mainWindow?.close()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopGlobalCursorPolling()
  globalShortcut.unregisterAll()
  if (tray) { tray.destroy(); tray = null }
})

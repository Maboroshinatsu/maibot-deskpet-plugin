import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, globalShortcut, desktopCapturer, protocol, net } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import { pathToFileURL } from 'url'

app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('in-process-gpu')

// 打包后渲染层经 file:// 加载，fetch/XHR 拿不到 out/renderer 之外的模型文件，
// 注册自定义协议把 models 根目录暴露成 deskpet://models/<relative>
protocol.registerSchemesAsPrivileged([
  { scheme: 'deskpet', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

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
  autoScreenshotEnabled: boolean
  autoScreenshotInterval: number
}

interface ModelEntry {
  /** 展示名，取自模型文件夹名 + 文件名 */
  name: string
  /** 渲染层可直接加载的相对 URL，例如 ./models/xxx/xxx.model3.json */
  url: string
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

  // 四个方向都只要求留出 minVisibleSize 的可见区域，
  // 这样桌宠可以贴到屏幕底部（压住任务栏），而不是被强制卡在工作区内。
  return {
    width,
    height,
    x: clamp(bounds.x, area.x + minVisibleSize - width, area.x + area.width - minVisibleSize),
    y: clamp(bounds.y, area.y + minVisibleSize - height, area.y + area.height - minVisibleSize),
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

/**
 * models 目录在 dev 与打包后位置不同：
 *   dev   → <project>/src/renderer/public/models（vite 直接从 public 提供）
 *   build → out/renderer/models（public 内容被拷到 renderer 输出目录）
 */
function getModelsRoot(): string | null {
  const built = path.join(__dirname, '../renderer/models')
  const source = path.join(app.getAppPath(), 'src/renderer/public/models')
  // dev 下渲染层直接读 public/，out/renderer 可能是上次 build 留下的旧副本，
  // 所以要先看源目录，否则新放进去的模型扫不出来
  const candidates = app.isPackaged
    ? [built, path.join(process.resourcesPath, 'models')]
    : [source, built]
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir
    } catch {
      // 试下一个候选路径
    }
  }
  return null
}

function scanModelFiles(root: string): ModelEntry[] {
  const found: ModelEntry[] = []
  const MAX_DEPTH = 5

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.model3.json')) {
        const relative = path.relative(root, full).split(path.sep).join('/')
        const base = entry.name.replace(/\.model3\.json$/i, '')
        // 用 models/ 下的顶层文件夹做前缀，而不是紧邻的父目录 ——
        // 后者常常是 runtime/ 这种通用容器名，看不出是哪个模型
        const topFolder = relative.includes('/') ? relative.split('/')[0] : ''
        found.push({
          name: !topFolder || topFolder === base ? base : `${topFolder} / ${base}`,
          // dev 下 vite 从 public/ 静态提供，相对路径即可；
          // 打包后相对路径解析到 out/renderer 之外就 404，必须走自定义协议
          url: app.isPackaged ? `deskpet://models/${relative}` : `./models/${relative}`,
        })
      }
    }
  }

  walk(root, 0)
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

function listModels(): ModelEntry[] {
  const root = getModelsRoot()
  if (!root) {
    console.warn('[deskpet] models directory not found')
    return []
  }
  return scanModelFiles(root)
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
      autoScreenshotEnabled: typeof parsed.autoScreenshotEnabled === 'boolean' ? parsed.autoScreenshotEnabled : false,
      autoScreenshotInterval:
        typeof parsed.autoScreenshotInterval === 'number' && parsed.autoScreenshotInterval >= 10
          ? parsed.autoScreenshotInterval
          : 60,
    }
  } catch {
    return {
      bounds: getDefaultWindowBounds(),
      alwaysOnTop: true,
      clickThroughLocked: false,
      hoverFadeEnabled: false,
      autoScreenshotEnabled: false,
      autoScreenshotInterval: 60,
    }
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

let saveStateTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSaveWindowState(): void {
  if (saveStateTimer) clearTimeout(saveStateTimer)
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null
    saveWindowState()
  }, 500)
}

function saveWindowState(): void {
  if (saveStateTimer) {
    clearTimeout(saveStateTimer)
    saveStateTimer = null
  }
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
      autoScreenshotEnabled: autoScreenshotTimer !== null,
      autoScreenshotInterval,
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
let pendingAutoScreenshot = false
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
  // dev 下渲染层由 vite 提供，out/renderer 并不存在，必须回落到源码里的 public/
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png'), path.join(__dirname, '../renderer/icon.png')]
    : [path.join(app.getAppPath(), 'src/renderer/public/icon.png'), path.join(__dirname, '../renderer/icon.png')]

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // 试下一个候选路径
    }
  }
  return candidates[0]
}

function createWindow(): void {
  const state = loadWindowState()
  const bounds = state.bounds
  lastSavedBounds = bounds
  alwaysOnTop = state.alwaysOnTop
  clickThroughLocked = state.clickThroughLocked
  hoverFadeEnabled = state.hoverFadeEnabled
  autoScreenshotInterval = state.autoScreenshotInterval
  pendingAutoScreenshot = state.autoScreenshotEnabled
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

  // 无边框窗口没有菜单，快捷键要手动接：设置项大多需要重载渲染层才生效
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const isReload = input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')
    if (isReload) {
      mainWindow?.webContents.reload()
      return
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  // move/resize 在拖动期间以指针频率触发，直接 writeFileSync 会每秒阻塞主进程数百次
  mainWindow.on('move', () => {
    enforceWindowBounds()
    scheduleSaveWindowState()
  })
  mainWindow.on('resize', () => {
    enforceWindowBounds()
    scheduleSaveWindowState()
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

let autoScreenshotTimer: ReturnType<typeof setInterval> | null = null
let autoScreenshotInterval = 60

function setAutoScreenshot(flag: boolean, intervalSec?: number): void {
  if (intervalSec && intervalSec > 0) autoScreenshotInterval = intervalSec
  if (autoScreenshotTimer) { clearInterval(autoScreenshotTimer); autoScreenshotTimer = null }
  if (flag) {
    autoScreenshotTimer = setInterval(captureScreen, autoScreenshotInterval * 1000)
  }
  saveWindowState()
  createTray()
}

function captureScreen(): void {
  // maxSize limits thumbnail to avoid WebSocket frame overflow
  desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } })
    .then((sources) => {
      if (sources.length === 0) return
      const png = sources[0].thumbnail.toPNG()
      const b64 = png.toString('base64')
      mainWindow?.webContents.send('screenshot-captured', b64)
    })
    .catch((err) => {
      console.warn('[deskpet] Screen capture failed:', err)
    })
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
    { label: '截图识图', click: () => { captureScreen() } },
    {
      label: `自动截图（每 ${autoScreenshotInterval} 秒）`,
      type: 'checkbox',
      checked: autoScreenshotTimer !== null,
      click: (mi) => { setAutoScreenshot(mi.checked) },
    },
    { label: '重置模型位置', click: () => { mainWindow?.webContents.send('reset-model-view') } },
    { label: '重置窗口位置', click: () => { resetWindowPosition() } },
    { label: '重置全部布局', click: () => { resetAllLayout() } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit() } }
  ]))
  tray.setToolTip(clickThroughLocked ? 'MaiBot 桌面宠物（已锁定穿透，请从托盘取消）' : 'MaiBot 桌面宠物')
}

app.whenReady().then(() => {
  protocol.handle('deskpet', async (request) => {
    const url = new URL(request.url)
    const root = getModelsRoot()
    if (!root || url.host !== 'models') return new Response('Not Found', { status: 404 })
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const full = path.normalize(path.join(root, rel))
    // 防目录穿越：解析后的路径必须仍在 models 根之内
    if (!full.startsWith(path.normalize(root + path.sep))) {
      return new Response('Forbidden', { status: 403 })
    }
    const resp = await net.fetch(pathToFileURL(full).toString())
    const headers = new Headers(resp.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(resp.body, { status: resp.status, headers })
  })

  createWindow()
  createTray()
  registerGlobalShortcuts()
  if (pendingAutoScreenshot) setAutoScreenshot(true)

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

  ipcMain.handle('stt-transcribe', async (_event, audioBuffer: ArrayBuffer, url?: string) => {
    let sttUrl: URL
    try {
      sttUrl = new URL(url || 'http://127.0.0.1:18530/stt')
    } catch {
      console.warn('[deskpet] Invalid STT URL:', url)
      return null
    }
    if (sttUrl.protocol !== 'http:') {
      console.warn('[deskpet] STT URL must be http:', url)
      return null
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(sttUrl.hostname)) {
      // 允许局域网 STT，但把目标记下来，避免录音被静默发去意料之外的主机
      console.warn('[deskpet] STT request to non-loopback host:', sttUrl.hostname)
    }
    const body = Buffer.from(audioBuffer)
    return new Promise<string | null>((resolve) => {
      const req = http.request({
        hostname: sttUrl.hostname, port: sttUrl.port, path: sttUrl.pathname + sttUrl.search, method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length },
        // 桥挂起时不设超时会让 promise 永不 settle，语音输入 UI 永久卡死
        timeout: 30_000,
      }, (res) => {
        // 不设编码则逐 chunk 独立转字符串，跨 TCP 包的 UTF-8 中文会碎成乱码
        res.setEncoding('utf-8')
        let data = ''
        res.on('data', (chunk: string) => data += chunk)
        res.on('end', () => {
          try { resolve(JSON.parse(data).text || null) } catch { resolve(null) }
        })
        res.on('error', () => resolve(null))
      })
      req.on('timeout', () => { req.destroy(new Error('STT request timeout')) })
      req.on('error', () => resolve(null))
      req.write(body)
      req.end()
    })
  })

  ipcMain.handle('set-auto-screenshot-interval', (_event, sec: number) => {
    if (!Number.isFinite(sec) || sec < 10) return
    autoScreenshotInterval = sec
    // 定时器在跑就按新间隔重建；没跑也要落盘并刷新托盘上的间隔文字
    setAutoScreenshot(autoScreenshotTimer !== null, sec)
  })

  ipcMain.handle('list-models', () => listModels())

  ipcMain.handle('reload-window', () => {
    mainWindow?.webContents.reload()
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

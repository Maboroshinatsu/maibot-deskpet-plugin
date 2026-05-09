import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import path from 'path'

app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('in-process-gpu')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 800,
    x: 100,
    y: 100,
    type: 'panel',
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  mainWindow.setAlwaysOnTop(true, 'floating')

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示/隐藏', click: () => { mainWindow?.isVisible() ? mainWindow?.hide() : mainWindow?.show() } },
    { label: '置顶', type: 'checkbox', checked: true, click: (mi) => { mainWindow?.setAlwaysOnTop(mi.checked, 'floating') } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit() } }
  ]))
  tray.setToolTip('MaiBot 桌面宠物')
}

app.whenReady().then(() => {
  createWindow()
  createTray()

  ipcMain.handle('drag-window', (event, { dx, dy }: { dx: number; dy: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })

  ipcMain.handle('set-always-on-top', (_event, flag: boolean) => {
    mainWindow?.setAlwaysOnTop(flag, 'floating')
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
  if (tray) { tray.destroy(); tray = null }
})

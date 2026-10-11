'use strict'
// Isolated launch of the real compiled application. No production files/config are changed.
const { app, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-ui-qa-'))
const userData = path.join(runDir, 'user-data')
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
const logPath = path.join(runDir, 'events.jsonl')
const log = (type, data = {}) => fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), type, ...data }) + '\n')
const ids = ['stt-bridge', 'tts-bridge', 'gpt-sovits', 'hotkey', 'cloud-tts']
fs.writeFileSync(path.join(userData, 'services.json'), JSON.stringify({
  autoStart: Object.fromEntries(ids.map(id => [id, false])), showTerminal: { hotkey: true },
}))
fs.writeFileSync(path.join(userData, 'window-state.json'), JSON.stringify({
  bounds: { x: 60, y: 60, width: 600, height: 800 }, alwaysOnTop: false,
  clickThroughLocked: false, hoverFadeEnabled: false, autoScreenshotEnabled: false,
}))
// Existing bundled folders need no migration/copy into the test profile.
for (const entry of fs.readdirSync(path.join(root, 'out/renderer/models'), { withFileTypes: true })) {
  if (entry.isDirectory()) fs.mkdirSync(path.join(userData, 'models', entry.name), { recursive: true })
}
const info = { pid: process.pid, runDir, userData, logPath }
fs.writeFileSync(path.join(os.tmpdir(), 'deskpet-ui-qa-current.json'), JSON.stringify(info, null, 2))
log('started', info)
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_e, level, message, line) => log('renderer-console', { level, message, line }))
  win.webContents.on('render-process-gone', (_e, details) => log('renderer-gone', details))
  win.webContents.on('did-fail-load', (_e, code, description) => log('load-failed', { code, description }))
  win.webContents.on('did-finish-load', () => {
    win.setTitle('MaiBot Deskpet — Runtime QA')
    log('window-loaded')
    let shot = 0
    const timer = setInterval(() => {
      void (async () => {
        try {
          const img = await win.webContents.capturePage()
          fs.writeFileSync(path.join(runDir, 'shot-' + String(++shot).padStart(3, '0') + '.png'), img.toPNG())
        } catch (e) { log('shot-error', { message: String(e) }) }
        if (shot >= 90) clearInterval(timer)
      })()
    }, 1000)
  })
  win.on('closed', () => log('window-closed'))
})
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    log('test-denied-permission', { permission }); callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = ['file:', 'deskpet:', 'data:', 'blob:', 'devtools:'].includes(new URL(details.url).protocol)
    if (!allowed) log('test-blocked-network', { url: details.url })
    callback({ cancel: !allowed })
  })
})
app.on('before-quit', () => log('test-cleanup'))
require(path.join(root, 'out/main/index.js'))

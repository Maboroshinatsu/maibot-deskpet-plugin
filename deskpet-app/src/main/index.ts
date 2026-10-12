import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, globalShortcut, desktopCapturer, protocol, net, shell, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import { pathToFileURL } from 'url'
import { ServiceManager, type ServiceId, type ServicesConfig } from './services'
import { createRuntimeApproval } from './runtime-approval'

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
  /** live2d = .model3.json；image-set = 静态立绘包（deskpet-images.json） */
  kind: 'live2d' | 'image-set'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampWindowBounds(bounds: WindowBoundsState): WindowBoundsState {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  const minVisibleSize = 120
  const navBarHalfSpan = 88 // 底部居中导航条宽 160px（半宽 80px + 8px 余量）
  const width = Math.max(bounds.width, MIN_WINDOW_WIDTH)
  const height = Math.max(bounds.height, MIN_WINDOW_HEIGHT)

  // 水平方向保证居中导航条始终留在工作区内；
  // 垂直方向保证窗口底边（导航条所在处 bottom: 4px）绝不越过工作区底边进入任务栏。
  const minVisibleX = Math.min(width, Math.max(minVisibleSize, Math.ceil(width / 2 + navBarHalfSpan)))
  const minX = area.x + minVisibleX - width
  const maxX = area.x + area.width - minVisibleX
  const maxY = area.y + area.height - height
  const minY = Math.min(area.y + minVisibleSize - height, maxY)

  return {
    width,
    height,
    x: clamp(bounds.x, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: clamp(bounds.y, minY, maxY),
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
  const bounds = getDefaultWindowBounds(lastSavedBounds.width, lastSavedBounds.height)
  applyWindowBounds(bounds)
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

/**
 * 用户模型目录：重装打包版时 NSIS 会清空安装目录（resources/models 里的
 * 自定义模型全没），而 userData 不动 —— 自定义模型/立绘包都应放这里。
 */
function getUserModelsRoot(): string {
  return path.join(app.getPath('userData'), 'models')
}

interface ModelRoot {
  fsPath: string
  /** bundled = 随包/源码目录（dev 下走 vite 相对 URL）；user = userData（一律走 deskpet://） */
  kind: 'bundled' | 'user'
}

/** 扫描顺序：用户目录在前（允许覆盖随包模型），随包目录在后 */
function getModelsRoots(): ModelRoot[] {
  const roots: ModelRoot[] = [{ fsPath: getUserModelsRoot(), kind: 'user' }]
  const bundled = getModelsRoot()
  if (bundled) roots.push({ fsPath: bundled, kind: 'bundled' })
  return roots
}

function scanModelFiles(root: ModelRoot): ModelEntry[] {
  const found: ModelEntry[] = []
  const MAX_DEPTH = 5

  const makeUrl = (relative: string): string => {
    // userData 的模型 dev/打包都走 deskpet://（vite 管不到那里）；
    // bundled 模型 dev 走 vite 相对路径，打包走 deskpet://
    if (root.kind === 'user' || app.isPackaged) return `deskpet://models/${relative}`
    return `./models/${relative}`
  }

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
        const relative = path.relative(root.fsPath, full).split(path.sep).join('/')
        const base = entry.name.replace(/\.model3\.json$/i, '')
        // 用 models/ 下的顶层文件夹做前缀，而不是紧邻的父目录 ——
        // 后者常常是 runtime/ 这种通用容器名，看不出是哪个模型
        const topFolder = relative.includes('/') ? relative.split('/')[0] : ''
        found.push({
          name: !topFolder || topFolder === base ? base : `${topFolder} / ${base}`,
          url: makeUrl(relative),
          kind: 'live2d',
        })
      } else if (entry.isFile() && entry.name === 'deskpet-images.json') {
        // 静态立绘包：清单即模型入口，展示名直接用所在文件夹
        const relative = path.relative(root.fsPath, full).split(path.sep).join('/')
        const topFolder = relative.includes('/') ? relative.split('/')[0] : ''
        found.push({
          name: topFolder || '立绘包',
          url: makeUrl(relative),
          kind: 'image-set',
        })
      }
    }
  }

  walk(root.fsPath, 0)
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

function listModels(): ModelEntry[] {
  const merged: ModelEntry[] = []
  const seenRel = new Set<string>()
  for (const root of getModelsRoots()) {
    for (const entry of scanModelFiles(root)) {
      // 用户目录与随包目录出现同名相对路径时，用户目录的赢（它排在前面）
      const relKey = entry.url.replace(/^deskpet:\/\/models\//, '').replace(/^\.\/models\//, '')
      if (seenRel.has(relKey)) continue
      seenRel.add(relKey)
      merged.push(entry)
    }
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name))
}

export interface ModelExpressionAsset {
  name: string
  file: string
  parameters: Array<{
    id: string
    value: number
    blend?: string
  }>
}

export interface ModelDiskPresetStep {
  label?: string
  durationMs: number
  holdMs: number
  controls: string[]
  parameters: Record<string, number>
}

export interface ModelDiskPreset {
  id: string
  label: string
  description: string
  emotion: string
  group?: string
  controls: string[]
  parameters?: Record<string, number>
  steps?: ModelDiskPresetStep[]
  finishMode?: 'hold' | 'revert' | 'loop'
  revertHoldMs?: number
  motion?: { group: string; index?: number } | 'none'
  custom?: boolean
}

export interface ModelDiskAssets {
  cdiParameters: Record<string, { name: string; group: string }>
  cdiParts: Record<string, string>
  physicsOutputIds: string[]
  vtubeHotkeys: Record<string, string>
  expressions: ModelExpressionAsset[]
  poseGroups?: string[][]
  savedPresets?: ModelDiskPreset[] | null
}

const MODEL_PRESETS_FILENAME = 'deskpet-presets.json'

function sanitizeParamRecord(raw: unknown): Record<string, number> {
  const cleanParams: Record<string, number> = {}
  if (raw && typeof raw === 'object') {
    for (const [pid, pval] of Object.entries(raw as Record<string, unknown>)) {
      const num = Number(pval)
      if (pid && Number.isFinite(num)) cleanParams[pid] = num
    }
  }
  return cleanParams
}

function sanitizeModelPresets(raw: unknown): ModelDiskPreset[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { presets?: unknown }).presets)
      ? (raw as { presets: unknown[] }).presets
      : null
  if (!list) return null
  const result: ModelDiskPreset[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = String(rec.id || '').trim()
    const label = String(rec.label || '').trim()
    if (!id || !label) continue
    const rawGroup = typeof rec.group === 'string' ? rec.group.trim() : ''
    const cleanParams = sanitizeParamRecord(rec.parameters)
    let cleanSteps: ModelDiskPresetStep[] | undefined
    if (Array.isArray(rec.steps) && rec.steps.length > 0) {
      const parsedSteps: ModelDiskPresetStep[] = []
      for (const st of rec.steps) {
        if (!st || typeof st !== 'object') continue
        const srec = st as Record<string, unknown>
        const dur = Number(srec.durationMs)
        const hold = Number(srec.holdMs)
        parsedSteps.push({
          ...(typeof srec.label === 'string' && srec.label.trim()
            ? { label: srec.label.trim() }
            : {}),
          durationMs: Number.isFinite(dur) ? Math.max(40, Math.min(5000, Math.round(dur))) : 350,
          holdMs: Number.isFinite(hold) ? Math.max(0, Math.min(10000, Math.round(hold))) : 150,
          controls: Array.isArray(srec.controls)
            ? srec.controls.map((c) => String(c).trim()).filter(Boolean)
            : [],
          parameters: sanitizeParamRecord(srec.parameters),
        })
      }
      if (parsedSteps.length > 0) cleanSteps = parsedSteps
    }
    const rawFinish = String(rec.finishMode || '').trim()
    const finishMode: 'hold' | 'revert' | 'loop' | undefined =
      rawFinish === 'hold' || rawFinish === 'revert' || rawFinish === 'loop'
        ? rawFinish
        : undefined
    const rawRevertHold = Number(rec.revertHoldMs)
    const revertHoldMs = Number.isFinite(rawRevertHold)
      ? Math.max(100, Math.min(15000, Math.round(rawRevertHold)))
      : undefined
    let motion: { group: string; index?: number } | 'none' | undefined
    if (rec.motion === 'none') {
      motion = 'none'
    } else if (rec.motion && typeof rec.motion === 'object') {
      const mrec = rec.motion as Record<string, unknown>
      const group = String(mrec.group || '').trim()
      if (group) {
        const idx = Number(mrec.index)
        motion = Number.isFinite(idx) && idx >= 0 ? { group, index: Math.floor(idx) } : { group }
      }
    }

    result.push({
      id,
      label,
      description: String(rec.description || '').trim(),
      emotion: String(rec.emotion || 'neutral').trim() || 'neutral',
      ...(rawGroup ? { group: rawGroup } : {}),
      controls: Array.isArray(rec.controls)
        ? rec.controls.map((c) => String(c).trim()).filter(Boolean)
        : [],
      parameters: cleanParams,
      ...(cleanSteps ? { steps: cleanSteps } : {}),
      ...(finishMode ? { finishMode } : {}),
      ...(revertHoldMs !== undefined ? { revertHoldMs } : {}),
      ...(motion !== undefined ? { motion } : {}),
      custom: true,
    })
  }
  return result
}

function resolveModelFilePath(modelUrl: string): string | null {
  if (!modelUrl || typeof modelUrl !== 'string') return null
  let rel = ''
  try {
    if (modelUrl.startsWith('deskpet://models/')) {
      const parsed = new URL(modelUrl)
      rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
    } else if (modelUrl.startsWith('./models/')) {
      rel = decodeURIComponent(modelUrl.slice('./models/'.length)).replace(/^\/+/, '')
    } else if (modelUrl.startsWith('/models/')) {
      rel = decodeURIComponent(modelUrl.slice('/models/'.length)).replace(/^\/+/, '')
    } else {
      const parsed = new URL(modelUrl)
      const idx = parsed.pathname.indexOf('/models/')
      if (idx >= 0) {
        rel = decodeURIComponent(parsed.pathname.slice(idx + '/models/'.length)).replace(/^\/+/, '')
      }
    }
  } catch {
    return null
  }
  if (!rel) return null

  for (const root of getModelsRoots()) {
    const candidate = path.normalize(path.join(root.fsPath, rel))
    if (!candidate.startsWith(path.normalize(root.fsPath + path.sep))) continue
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function saveModelPresetsToDisk(modelUrl: string, presets: unknown): boolean {
  const modelFile = resolveModelFilePath(modelUrl)
  if (!modelFile) return false
  const sanitized = sanitizeModelPresets(presets)
  if (!sanitized) return false
  const targetFile = path.join(path.dirname(modelFile), MODEL_PRESETS_FILENAME)
  try {
    fs.writeFileSync(
      targetFile,
      JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          presets: sanitized,
        },
        null,
        2,
      ),
      'utf-8',
    )
    return true
  } catch (err) {
    console.warn('[deskpet] Failed to write deskpet-presets.json:', err)
    return false
  }
}

function inspectModelAssets(modelUrl: string): ModelDiskAssets | null {
  const modelFile = resolveModelFilePath(modelUrl)
  if (!modelFile) return null
  const modelDir = path.dirname(modelFile)

  const cdiParameters: Record<string, { name: string; group: string }> = {}
  const cdiParts: Record<string, string> = {}
  const physicsOutputSet = new Set<string>()
  const vtubeHotkeys: Record<string, string> = {}
  const expressions: ModelExpressionAsset[] = []

  const cdiFiles: string[] = []
  const physicsFiles: string[] = []
  const vtubeFiles: string[] = []
  const expFiles: string[] = []
  const poseFiles: string[] = []
  const poseGroups: string[][] = []

  const walkAssets = (dir: string, depth: number): void => {
    if (depth > 2) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkAssets(full, depth + 1)
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase()
        if (lower.endsWith('.cdi3.json')) cdiFiles.push(full)
        else if (lower.endsWith('.physics3.json')) physicsFiles.push(full)
        else if (lower.endsWith('.vtube.json')) vtubeFiles.push(full)
        else if (lower.endsWith('.exp3.json')) expFiles.push(full)
        else if (lower.endsWith('.pose3.json')) poseFiles.push(full)
      }
    }
  }

  walkAssets(modelDir, 0)

  for (const posePath of poseFiles) {
    try {
      const pose = JSON.parse(fs.readFileSync(posePath, 'utf-8'))
      if (Array.isArray(pose?.Groups)) {
        for (const group of pose.Groups) {
          if (!Array.isArray(group)) continue
          const partIds = group
            .map((entry: any) => (typeof entry?.Id === 'string' ? entry.Id.trim() : ''))
            .filter(Boolean)
          if (partIds.length >= 2) {
            poseGroups.push(partIds)
          }
        }
      }
    } catch {
      // ignore malformed pose3.json
    }
  }

  for (const cdiPath of cdiFiles) {
    try {
      const cdi = JSON.parse(fs.readFileSync(cdiPath, 'utf-8'))
      const groups: Record<string, string> = {}
      if (Array.isArray(cdi?.ParameterGroups)) {
        for (const g of cdi.ParameterGroups) {
          if (typeof g?.Id === 'string') {
            groups[g.Id] = typeof g?.Name === 'string' ? g.Name.trim() : ''
          }
        }
      }
      if (Array.isArray(cdi?.Parameters)) {
        for (const p of cdi.Parameters) {
          if (typeof p?.Id === 'string') {
            cdiParameters[p.Id] = {
              name: typeof p?.Name === 'string' ? p.Name.trim() : '',
              group: typeof p?.GroupId === 'string' ? (groups[p.GroupId] ?? '') : '',
            }
          }
        }
      }
      if (Array.isArray(cdi?.Parts)) {
        for (const part of cdi.Parts) {
          if (typeof part?.Id === 'string' && typeof part?.Name === 'string') {
            cdiParts[part.Id] = part.Name.trim()
          }
        }
      }
    } catch {
      // ignore malformed cdi3.json
    }
  }

  for (const physPath of physicsFiles) {
    try {
      const phys = JSON.parse(fs.readFileSync(physPath, 'utf-8'))
      if (Array.isArray(phys?.PhysicsSettings)) {
        for (const setting of phys.PhysicsSettings) {
          if (!Array.isArray(setting?.Output)) continue
          for (const out of setting.Output) {
            const destId = out?.Destination?.Id
            if (typeof destId === 'string' && destId) {
              physicsOutputSet.add(destId)
            }
          }
        }
      }
    } catch {
      // ignore malformed physics3.json
    }
  }

  for (const vtPath of vtubeFiles) {
    try {
      const vt = JSON.parse(fs.readFileSync(vtPath, 'utf-8'))
      if (Array.isArray(vt?.Hotkeys)) {
        for (const hk of vt.Hotkeys) {
          if (typeof hk?.File === 'string' && hk.File && typeof hk?.Name === 'string' && hk.Name.trim()) {
            vtubeHotkeys[hk.File] = hk.Name.trim()
          }
        }
      }
    } catch {
      // ignore malformed vtube.json
    }
  }

  expFiles.sort((a, b) => a.localeCompare(b))
  for (const expPath of expFiles) {
    try {
      const exp = JSON.parse(fs.readFileSync(expPath, 'utf-8'))
      if (!Array.isArray(exp?.Parameters)) continue
      const params: Array<{ id: string; value: number; blend?: string }> = []
      for (const p of exp.Parameters) {
        if (typeof p?.Id === 'string' && typeof p?.Value === 'number') {
          params.push({
            id: p.Id,
            value: p.Value,
            ...(typeof p?.Blend === 'string' ? { blend: p.Blend } : {}),
          })
        }
      }
      const baseName = path.basename(expPath)
      const stem = baseName.replace(/\.exp3\.json$/i, '')
      expressions.push({
        name: stem,
        file: baseName,
        parameters: params,
      })
    } catch {
      // ignore malformed exp3.json
    }
  }

  let savedPresets: ModelDiskPreset[] | null = null
  const presetsPath = path.join(modelDir, MODEL_PRESETS_FILENAME)
  try {
    if (fs.existsSync(presetsPath) && fs.statSync(presetsPath).isFile()) {
      const rawPresets = JSON.parse(fs.readFileSync(presetsPath, 'utf-8'))
      savedPresets = sanitizeModelPresets(rawPresets)
    }
  } catch {
    // ignore malformed deskpet-presets.json
  }

  return {
    cdiParameters,
    cdiParts,
    physicsOutputIds: [...physicsOutputSet],
    vtubeHotkeys,
    expressions,
    poseGroups,
    savedPresets,
  }
}

/** 随包目录里非自带的文件夹视为用户模型，一次性迁到 userData（之后重装不再丢） */
function migrateUserModelsOnce(): void {
  const bundled = getModelsRoot()
  if (!bundled) return
  const BUNDLED_SET = new Set(['hiyori_pro_zh', 'sample_static', 'README.md'])
  const userRoot = getUserModelsRoot()
  try {
    for (const entry of fs.readdirSync(bundled, { withFileTypes: true })) {
      if (!entry.isDirectory() || BUNDLED_SET.has(entry.name)) continue
      const dest = path.join(userRoot, entry.name)
      if (fs.existsSync(dest)) continue // 已有同名就不覆盖
      fs.cpSync(path.join(bundled, entry.name), dest, { recursive: true })
      console.info(`[deskpet] 用户模型已从安装目录迁移到 userData: ${entry.name}`)
    }
  } catch (err) {
    console.warn('[deskpet] 用户模型迁移失败:', err)
  }
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
let lastDragAt = 0

function applyWindowBounds(next: WindowBoundsState): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  enforcingWindowBounds = true
  try {
    lastSavedBounds = next
    mainWindow.setBounds(next)
  } finally {
    enforcingWindowBounds = false
  }
}

function enforceWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || enforcingWindowBounds) return
  if (Date.now() - lastDragAt < 150) return
  const current = mainWindow.getBounds()
  // Windows 高分屏（如 125%/150% 缩放）下，仅移动窗口位置也会令 getBounds() 的宽高产生 1~2px 的取整抖动；
  // 若直接把抖动后的宽高喂回 setBounds，每次移动都会把窗口撑大 1~2px。
  const width = Math.abs(current.width - lastSavedBounds.width) > 2 ? current.width : lastSavedBounds.width
  const height = Math.abs(current.height - lastSavedBounds.height) > 2 ? current.height : lastSavedBounds.height
  const candidate = { x: current.x, y: current.y, width, height }
  const next = clampWindowBounds(candidate)
  if (current.x !== next.x || current.y !== next.y || width !== next.width || height !== next.height) {
    applyWindowBounds(next)
  } else {
    lastSavedBounds = next
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
const serviceManager = new ServiceManager((channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
})
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
  mainWindow?.webContents.send('set-click-through-locked', flag)
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
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return

    const cursor = screen.getCursorScreenPoint()
    if (cursor.x === lastCursorX && cursor.y === lastCursorY) return

    lastCursorX = cursor.x
    lastCursorY = cursor.y

    const bounds = lastSavedBounds
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

function getWindowPlacement(): {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  workAreaX: number
  workAreaY: number
  workAreaWidth: number
  workAreaHeight: number
} {
  const bounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : lastSavedBounds
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  return {
    windowX: bounds.x,
    windowY: bounds.y,
    windowWidth: bounds.width,
    windowHeight: bounds.height,
    workAreaX: area.x,
    workAreaY: area.y,
    workAreaWidth: area.width,
    workAreaHeight: area.height,
  }
}

function sendWindowPlacement(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('window-placement', getWindowPlacement())
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
  // 自动化测试（tests/l0-e2e.cjs 等）设置 DESKPET_HEADLESS=1 时隐藏窗口，
  // 避免测试期间反复闪现打扰用户；渲染与 DOM 仍然正常。
  const headlessForTests = process.env.DESKPET_HEADLESS === '1'
  mainWindow = new BrowserWindow({
    show: !headlessForTests,
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
    mainWindow?.webContents.send('set-click-through-locked', clickThroughLocked)
    sendWindowPlacement()
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
    sendWindowPlacement()
    scheduleSaveWindowState()
  })
  mainWindow.on('resize', () => {
    enforceWindowBounds()
    sendWindowPlacement()
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
    if (url.host !== 'models') return new Response('Not Found', { status: 404 })
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    // 用户目录优先，随包目录兜底：同名相对路径用户的赢
    let full: string | null = null
    for (const root of getModelsRoots()) {
      const candidate = path.normalize(path.join(root.fsPath, rel))
      // 防目录穿越：解析后的路径必须仍在该 models 根之内
      if (!candidate.startsWith(path.normalize(root.fsPath + path.sep))) continue
      if (fs.existsSync(candidate)) {
        full = candidate
        break
      }
    }
    if (!full) return new Response('Not Found', { status: 404 })
    const resp = await net.fetch(pathToFileURL(full).toString())
    const headers = new Headers(resp.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(resp.body, { status: resp.status, headers })
  })

  migrateUserModelsOnce()

  createWindow()
  createTray()
  registerGlobalShortcuts()
  if (pendingAutoScreenshot) setAutoScreenshot(true)

  ipcMain.handle('drag-window', (event, { dx, dy }: { dx: number; dy: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win !== mainWindow) return
    lastDragAt = Date.now()
    const nextBounds = clampWindowBounds({
      width: lastSavedBounds.width,
      height: lastSavedBounds.height,
      x: lastSavedBounds.x + dx,
      y: lastSavedBounds.y + dy,
    })
    applyWindowBounds(nextBounds)
    scheduleSaveWindowState()
  })

  ipcMain.handle('get-window-placement', () => getWindowPlacement())

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
    const cleanTranscript = (rawText: unknown): string | null => {
      if (typeof rawText !== 'string') return null
      const cleaned = rawText.replace(/<\|[^|]+\|>/g, '').trim()
      return cleaned || null
    }

    const body = Buffer.from(audioBuffer)
    const cloudStt = serviceManager.getSttRuntimeConfig()

    if (cloudStt.backend) {
      if (!cloudStt.apiKey && cloudStt.backend !== 'openai') {
        throw new Error(`云端 STT (${cloudStt.backend}) 尚未配置 API Key`)
      }

      if (cloudStt.backend === 'dashscope') {
        const endpoint =
          cloudStt.endpoint ||
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
        const model = cloudStt.model || 'qwen-audio-asr'
        const audioDataUri = `data:audio/wav;base64,${body.toString('base64')}`
        const resp = await net.fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cloudStt.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            input: {
              messages: [
                {
                  role: 'user',
                  content: [{ audio: audioDataUri }],
                },
              ],
            },
          }),
        })
        if (!resp.ok) {
          throw new Error(`DashScope STT HTTP ${resp.status}`)
        }
        const json = (await resp.json()) as {
          output?: { choices?: Array<{ message?: { content?: Array<{ text?: string }> | string } }> }
          text?: string
        }
        const msgContent = json.output?.choices?.[0]?.message?.content
        const text =
          typeof msgContent === 'string'
            ? msgContent
            : Array.isArray(msgContent)
              ? msgContent.map((c) => c.text || '').join('')
              : json.text
        return cleanTranscript(text)
      }

      // OpenAI 兼容 /v1/audio/transcriptions 格式：siliconflow / groq / openai
      const defaultEndpoints: Record<string, string> = {
        siliconflow: 'https://api.siliconflow.cn/v1/audio/transcriptions',
        groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
        openai: 'https://api.openai.com/v1/audio/transcriptions',
      }
      const defaultModels: Record<string, string> = {
        siliconflow: 'FunAudioLLM/SenseVoiceSmall',
        groq: 'whisper-large-v3-turbo',
        openai: 'whisper-1',
      }
      const endpoint = cloudStt.endpoint || defaultEndpoints[cloudStt.backend] || defaultEndpoints.openai
      const model = cloudStt.model || defaultModels[cloudStt.backend] || 'FunAudioLLM/SenseVoiceSmall'

      const form = new FormData()
      form.append('file', new Blob([body], { type: 'audio/wav' }), 'speech.wav')
      form.append('model', model)
      if (cloudStt.backend === 'groq') {
        form.append('language', 'zh')
      }

      const headers: Record<string, string> = {}
      if (cloudStt.apiKey) {
        headers.Authorization = `Bearer ${cloudStt.apiKey}`
      }

      const resp = await net.fetch(endpoint, {
        method: 'POST',
        headers,
        body: form,
      })
      if (!resp.ok) {
        throw new Error(`Cloud STT (${cloudStt.backend}) HTTP ${resp.status}`)
      }
      const json = (await resp.json()) as { text?: string }
      return cleanTranscript(json.text)
    }

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
    return new Promise<string | null>((resolve, reject) => {
      const req = http.request({
        hostname: sttUrl.hostname, port: sttUrl.port, path: sttUrl.pathname + sttUrl.search, method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length },
        // 首次按需下载 226MB INT8 模型或桥首载可能耗时较长，放宽超时上限
        timeout: 180_000,
      }, (res) => {
        // 不设编码则逐 chunk 独立转字符串，跨 TCP 包的 UTF-8 中文会碎成乱码
        res.setEncoding('utf-8')
        let data = ''
        res.on('data', (chunk: string) => data += chunk)
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`STT HTTP ${res.statusCode}`))
            return
          }
          try { resolve(cleanTranscript(JSON.parse(data).text)) } catch { resolve(null) }
        })
        res.on('error', (err) => reject(err))
      })
      req.on('timeout', () => { req.destroy(new Error('STT request timeout')) })
      req.on('error', (err) => reject(err))
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
  ipcMain.handle('inspect-model-assets', (_event, modelUrl: string) => inspectModelAssets(modelUrl))
  ipcMain.handle('save-model-presets', (_event, modelUrl: string, presets: unknown) =>
    saveModelPresetsToDisk(modelUrl, presets),
  )

  ipcMain.handle('open-models-folder', () => {
    const dir = getUserModelsRoot()
    fs.mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })

  ipcMain.handle('services-list', () => serviceManager.list())
  ipcMain.handle('service-start', (_event, id: ServiceId) => serviceManager.start(id))
  ipcMain.handle('service-stop', (_event, id: ServiceId) => serviceManager.stop(id))
  ipcMain.handle('service-restart', (_event, id: ServiceId) => serviceManager.restart(id))
  ipcMain.handle('service-logs', (_event, id: ServiceId) => serviceManager.logsOf(id))
  ipcMain.handle('services-get-config', () => serviceManager.getConfig())
  ipcMain.handle('services-set-config', (_event, patch: Partial<ServicesConfig>) => serviceManager.setConfig(patch))
  // 仅主窗口顶层 frame 可提交候选；任何网络消息本身都不能批准本机执行。
  const isRuntimeSender = (event: Electron.IpcMainInvokeEvent) =>
    !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  ipcMain.handle('services-set-detected-python', (event, pythonPath: unknown, sourceUrl: unknown) => {
    if (isRuntimeSender(event)) serviceManager.setDetectedPython(pythonPath, sourceUrl)
  })
  ipcMain.handle('services-clear-detected-python', (event) => {
    if (isRuntimeSender(event)) serviceManager.clearDetectedPython()
  })
  ipcMain.handle('services-runtime-candidate', (event) => isRuntimeSender(event) ? serviceManager.getRuntimeCandidate() : null)
  const approveRuntime = createRuntimeApproval<Electron.IpcMainInvokeEvent>({
    isTrustedSender: isRuntimeSender,
    getCandidate: () => serviceManager.getRuntimeCandidate(),
    approve: (id) => serviceManager.approveDetectedPython(id),
    confirm: async (candidate) => {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: 'warning', title: '确认本机 Python 解释器',
        message: '允许本次连接使用这个本机解释器启动桌宠后台服务吗？',
        detail: `来源：${candidate.sourceUrl}\n路径：${candidate.pythonPath}\n\n仅允许你认识的 MaiBot 本机环境。确认后可能重试已设自启且因缺解释器/依赖而失败的服务；不会启动其他服务。显式配置仍优先。断线后需重新确认。`,
        buttons: ['取消', '确认使用'], defaultId: 0, cancelId: 0, noLink: true,
      })
      return result.response === 1
    },
  })
  ipcMain.handle('services-approve-detected-python', approveRuntime)
  mainWindow?.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) {
      serviceManager.clearDetectedPython()
    }
  })
  mainWindow?.webContents.on('render-process-gone', () => {
    serviceManager.clearDetectedPython()
  })

  // 一键启动的核心：应用起来就把配置为自启的后台服务拉起来
  serviceManager.autoStartAll()

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
  serviceManager.stopAllSync()
})

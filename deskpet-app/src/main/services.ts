/**
 * 后台服务管理器 —— 取代 start.bat 的"一键启动"
 *
 * 管理 STT、本地/云 TTS、GPT-SoVITS API 与 PTT 热键桥。
 * MaiBot 本体不归它管（独立的 OneKey 安装），前端只做连通性显示。
 *
 * 普通服务两种运行模式（PTT 热键桥固定使用隐藏模式保留事件管道）：
 *   - 隐藏模式（默认）：stdout/stderr 进环形日志缓冲，通过 IPC 推给设置面板
 *   - 终端模式：隐藏的 cmd 通过 start 创建用户选择的控制台窗口
 * 两种模式下进程句柄都在我们手里，退出时统一 taskkill /T 杀进程树。
 */
import { spawn, execFile, execFileSync, ChildProcess } from 'child_process'
import net from 'net'
import path from 'path'
import fs from 'fs'
import { app, safeStorage } from 'electron'
import { validateDetectedPython } from './runtime-policy'

const API_KEY_MASK = '••••••••'

export type ServiceId = 'stt-bridge' | 'tts-bridge' | 'gpt-sovits' | 'hotkey' | 'cloud-tts'
export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface ServicesConfig {
  /** 空串 = 用 PATH 里的 python */
  pythonPath: string
  /** GPT-SoVITS 整合包目录；空串 = 按常见路径自动探测 */
  gsvDir: string
  /** GPT-SoVITS 参考音频路径（角色声线）；空串 = 未配置，TTS 桥会拒绝合成 */
  ttsRefAudio: string
  /** 参考音频里说的文本内容 */
  ttsPromptText: string
  /** 全局 PTT 热键（pynput 键名，如 f9 / scroll_lock / mouse_x1）；空串 = 热键桥不可用 */
  pttKey: string
  /** 云端 STT 后端：空串 = 本地离线 STT 桥；siliconflow / dashscope / groq / openai */
  sttBackend: string
  /** 云端 STT API Key（加密落盘；选 dashscope 且留空时可自动复用云 TTS 的百炼 Key） */
  sttApiKey: string
  /** 云端 STT 模型名（空 = 各后端推荐默认模型） */
  sttModel: string
  /** 自定义 STT 端点（仅 openai 兼容模式或自建服务使用） */
  sttEndpoint: string
  /** 云 TTS 后端：siliconflow / cosyvoice / mimo / fishaudio / gsv2p / openai；空串 = 本地 GSV；off = 不启用 */
  ttsBackend: string
  /** 云 TTS 的 API Key / Token（后端对应的那把） */
  ttsApiKey: string
  /** 云 TTS 音色名（空 = 各后端默认音色） */
  ttsVoice: string
  /** 云 TTS 模型名（空 = 各后端默认模型） */
  ttsModel: string
  /** 自定义 TTS 端点地址（空 = 各后端官方默认地址） */
  ttsEndpoint: string
  autoStart: Record<ServiceId, boolean>
  showTerminal: Record<ServiceId, boolean>
}

export interface RuntimeCandidate {
  id: string
  pythonPath: string
  sourceUrl: string
}

export interface ServiceState {
  id: ServiceId
  name: string
  port: number
  status: ServiceStatus
  pid: number | null
  /** 不可用原因 / 最近错误，给 UI 直接展示 */
  detail: string
  /** 前置条件是否满足（脚本存在、GSV 目录有效） */
  available: boolean
  showTerminal: boolean
  autoStart: boolean
}

interface ServiceDef {
  id: ServiceId
  name: string
  port: number
  resolve: () => { command: string; args: string[]; cwd: string; env?: Record<string, string> } | { unavailable: string }
}

const LOG_LIMIT = 400
const PROBE_INTERVAL_MS = 2000

const DEFAULT_CONFIG: ServicesConfig = {
  pythonPath: '',
  gsvDir: '',
  ttsRefAudio: '',
  ttsPromptText: '',
  pttKey: 'f9',
  sttBackend: '',
  sttApiKey: '',
  sttModel: '',
  sttEndpoint: '',
  ttsBackend: '',
  ttsApiKey: '',
  ttsVoice: '',
  ttsModel: '',
  ttsEndpoint: '',
  autoStart: { 'stt-bridge': true, 'tts-bridge': true, 'gpt-sovits': true, hotkey: true, 'cloud-tts': false },
  showTerminal: { 'stt-bridge': false, 'tts-bridge': false, 'gpt-sovits': false, hotkey: false, 'cloud-tts': false },
}

const GSV_CANDIDATES = [
  'D:\\GPT-SoVITS-v2pro-20250604',
  'C:\\GPT-SoVITS-v2pro-20250604',
  path.join(process.env.USERPROFILE || '', 'GPT-SoVITS-v2pro-20250604'),
]

const WIN32_VK_MAP: Record<string, number> = {
  mouse4: 0x05,
  mouse_x1: 0x05,
  mouse5: 0x06,
  mouse_x2: 0x06,
  mouse3: 0x04,
  mouse_middle: 0x04,
  scroll_lock: 0x91,
  pause: 0x13,
  caps_lock: 0x14,
  print_screen: 0x2c,
  insert: 0x2d,
  delete: 0x2e,
  home: 0x24,
  end: 0x23,
  page_up: 0x21,
  page_down: 0x22,
  space: 0x20,
  tab: 0x09,
  '`': 0xc0,
  '~': 0xc0,
  '-': 0xbd,
  '_': 0xbd,
  '=': 0xbb,
  '+': 0xbb,
  '[': 0xdb,
  '{': 0xdb,
  ']': 0xdd,
  '}': 0xdd,
  '\\': 0xdc,
  '|': 0xdc,
  ';': 0xba,
  ':': 0xba,
  "'": 0xde,
  '"': 0xde,
  ',': 0xbc,
  '<': 0xbc,
  '.': 0xbe,
  '>': 0xbe,
  '/': 0xbf,
  '?': 0xbf,
}

function resolveHotkeyVirtualKey(rawSpec: string): number | null {
  const spec = rawSpec.trim().toLowerCase()
  if (!spec) return null
  if (Object.prototype.hasOwnProperty.call(WIN32_VK_MAP, spec)) {
    return WIN32_VK_MAP[spec]
  }
  const fnMatch = /^f(\d{1,2})$/.exec(spec)
  if (fnMatch) {
    const fnNum = Number(fnMatch[1])
    if (fnNum >= 1 && fnNum <= 24) return 0x70 + (fnNum - 1)
  }
  if (/^[a-z0-9]$/.test(spec)) {
    return spec.toUpperCase().charCodeAt(0)
  }
  return null
}

function buildWin32HotkeyScript(vk: number, keySpec: string): string {
  const safeSpec = keySpec.replace(/["`$]/g, '')
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class DeskpetNativeKey {',
    '  [DllImport("user32.dll")]',
    '  public static extern short GetAsyncKeyState(int vKey);',
    '}',
    '"@;',
    `[Console]::WriteLine("[hotkey-win32] listening key=${safeSpec} vk=0x${vk.toString(16).toUpperCase()}");`,
    '[Console]::Out.Flush();',
    '$parentPid = 0;',
    '[void][int]::TryParse($env:DESKPET_PARENT_PID, [ref]$parentPid);',
    '$pressed = $false;',
    '$tick = 0;',
    'while ($true) {',
    `  $down = ([DeskpetNativeKey]::GetAsyncKeyState(${vk}) -band 0x8000) -ne 0;`,
    '  if ($down -and -not $pressed) { $pressed = $true; [Console]::WriteLine("PTT_DOWN"); [Console]::Out.Flush(); }',
    '  elseif (-not $down -and $pressed) { $pressed = $false; [Console]::WriteLine("PTT_UP"); [Console]::Out.Flush(); }',
    '  $tick++;',
    '  if ($parentPid -gt 0 -and ($tick % 60 -eq 0)) {',
    '    try { [void][System.Diagnostics.Process]::GetProcessById($parentPid) } catch { exit 0 }',
    '  }',
    '  [System.Threading.Thread]::Sleep(16);',
    '}',
  ].join('\n')
}

export class ServiceManager {
  private config: ServicesConfig
  private processes = new Map<ServiceId, ChildProcess>()
  private status = new Map<ServiceId, ServiceStatus>()
  private detail = new Map<ServiceId, string>()
  private logs = new Map<ServiceId, string[]>()
  /** 用户主动 stop 的进程退出不算 error */
  private stopping = new Map<ChildProcess, object>()
  private starts = new Map<ServiceId, Promise<void>>()
  private generations = new Map<ServiceId, number>()
  private restarts = new Map<ServiceId, {
    proc: ChildProcess
    generation: number
    timer: ReturnType<typeof setTimeout>
  }>()
  private quitting = false
  /** stdout 按行解析时的跨 chunk 余量（事件行可能被两次 data 事件切断） */
  private lineBuffers = new Map<ChildProcess, string>()
  private pttHeld = new WeakSet<ChildProcess>()
  private pttCancelled = new WeakSet<ChildProcess>()
  private probeTimer: ReturnType<typeof setInterval> | null = null
  private emit: (channel: string, payload: unknown) => void

  constructor(emit: (channel: string, payload: unknown) => void) {
    this.emit = emit
    this.config = this.loadConfig()
  }

  // ── 配置持久化 ──────────────────────────────

  private configPath(): string {
    return path.join(app.getPath('userData'), 'services.json')
  }

  private loadConfig(): ServicesConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath(), 'utf-8')) as Partial<ServicesConfig> & {
        ttsApiKeyEncrypted?: string
        sttApiKeyEncrypted?: string
      }
      let ttsApiKey = typeof raw.ttsApiKey === 'string' ? raw.ttsApiKey : ''
      if (!ttsApiKey && typeof raw.ttsApiKeyEncrypted === 'string' && raw.ttsApiKeyEncrypted) {
        try {
          if (typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
            ttsApiKey = safeStorage.decryptString(Buffer.from(raw.ttsApiKeyEncrypted, 'base64'))
          }
        } catch {
          ttsApiKey = ''
        }
      }
      let sttApiKey = typeof raw.sttApiKey === 'string' ? raw.sttApiKey : ''
      if (!sttApiKey && typeof raw.sttApiKeyEncrypted === 'string' && raw.sttApiKeyEncrypted) {
        try {
          if (typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
            sttApiKey = safeStorage.decryptString(Buffer.from(raw.sttApiKeyEncrypted, 'base64'))
          }
        } catch {
          sttApiKey = ''
        }
      }
      return {
        pythonPath: typeof raw.pythonPath === 'string' ? raw.pythonPath : '',
        gsvDir: typeof raw.gsvDir === 'string' ? raw.gsvDir : '',
        ttsRefAudio: typeof raw.ttsRefAudio === 'string' ? raw.ttsRefAudio : '',
        ttsPromptText: typeof raw.ttsPromptText === 'string' ? raw.ttsPromptText : '',
        pttKey: typeof raw.pttKey === 'string' ? raw.pttKey : 'f9',
        sttBackend: typeof raw.sttBackend === 'string' ? raw.sttBackend : '',
        sttApiKey,
        sttModel: typeof raw.sttModel === 'string' ? raw.sttModel : '',
        sttEndpoint: typeof raw.sttEndpoint === 'string' ? raw.sttEndpoint : '',
        ttsBackend: typeof raw.ttsBackend === 'string' ? raw.ttsBackend : '',
        ttsApiKey,
        ttsVoice: typeof raw.ttsVoice === 'string' ? raw.ttsVoice : '',
        ttsModel: typeof raw.ttsModel === 'string' ? raw.ttsModel : '',
        ttsEndpoint: typeof raw.ttsEndpoint === 'string' ? raw.ttsEndpoint : '',
        autoStart: { ...DEFAULT_CONFIG.autoStart, ...(raw.autoStart ?? {}) },
        showTerminal: { ...DEFAULT_CONFIG.showTerminal, ...(raw.showTerminal ?? {}), hotkey: false },
      }
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    }
  }

  getConfig(): ServicesConfig {
    const copy: ServicesConfig = JSON.parse(JSON.stringify(this.config))
    if (copy.ttsApiKey) {
      copy.ttsApiKey = API_KEY_MASK
    }
    if (copy.sttApiKey) {
      copy.sttApiKey = API_KEY_MASK
    }
    return copy
  }

  /** 仅供主进程内部 stt-transcribe 使用，向主进程返回未脱敏的云端 STT 凭证 */
  getSttRuntimeConfig(): { backend: string; apiKey: string; model: string; endpoint: string } {
    const backend = (this.config.sttBackend || '').trim().toLowerCase()
    let apiKey = (this.config.sttApiKey || '').trim()
    // 若选择了阿里云百炼 STT 且未单独填 Key，自动复用云 TTS 中的百炼 CosyVoice Key
    if (!apiKey && backend === 'dashscope' && this.config.ttsBackend === 'cosyvoice') {
      apiKey = (this.config.ttsApiKey || '').trim()
    }
    return {
      backend,
      apiKey,
      model: (this.config.sttModel || '').trim(),
      endpoint: (this.config.sttEndpoint || '').trim(),
    }
  }

  setConfig(patch: Partial<ServicesConfig>): ServicesConfig {
    if (typeof patch.pythonPath === 'string') this.config.pythonPath = patch.pythonPath
    if (typeof patch.gsvDir === 'string') this.config.gsvDir = patch.gsvDir
    if (typeof patch.ttsRefAudio === 'string') this.config.ttsRefAudio = patch.ttsRefAudio
    if (typeof patch.ttsPromptText === 'string') this.config.ttsPromptText = patch.ttsPromptText
    if (typeof patch.pttKey === 'string') this.config.pttKey = patch.pttKey
    if (typeof patch.sttBackend === 'string') this.config.sttBackend = patch.sttBackend
    if (typeof patch.sttApiKey === 'string' && patch.sttApiKey !== API_KEY_MASK) {
      this.config.sttApiKey = patch.sttApiKey
    }
    if (typeof patch.sttModel === 'string') this.config.sttModel = patch.sttModel
    if (typeof patch.sttEndpoint === 'string') this.config.sttEndpoint = patch.sttEndpoint
    if (typeof patch.ttsBackend === 'string') this.config.ttsBackend = patch.ttsBackend
    if (typeof patch.ttsApiKey === 'string' && patch.ttsApiKey !== API_KEY_MASK) {
      this.config.ttsApiKey = patch.ttsApiKey
    }
    if (typeof patch.ttsVoice === 'string') this.config.ttsVoice = patch.ttsVoice
    if (typeof patch.ttsModel === 'string') this.config.ttsModel = patch.ttsModel
    if (typeof patch.ttsEndpoint === 'string') this.config.ttsEndpoint = patch.ttsEndpoint
    if (patch.autoStart) this.config.autoStart = { ...this.config.autoStart, ...patch.autoStart }
    if (patch.showTerminal) this.config.showTerminal = { ...this.config.showTerminal, ...patch.showTerminal }
    // 热键事件依赖 stdout；旧配置和直接 IPC 调用也不能启用会丢事件的终端模式。
    this.config.showTerminal.hotkey = false
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true })
      const diskConfig: Record<string, unknown> = JSON.parse(JSON.stringify(this.config))
      if (
        this.config.ttsApiKey &&
        typeof safeStorage?.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable()
      ) {
        diskConfig.ttsApiKey = ''
        diskConfig.ttsApiKeyEncrypted = safeStorage.encryptString(this.config.ttsApiKey).toString('base64')
      }
      if (
        this.config.sttApiKey &&
        typeof safeStorage?.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable()
      ) {
        diskConfig.sttApiKey = ''
        diskConfig.sttApiKeyEncrypted = safeStorage.encryptString(this.config.sttApiKey).toString('base64')
      }
      fs.writeFileSync(this.configPath(), JSON.stringify(diskConfig, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[services] failed to persist config:', err)
    }
    this.pushAllStates()
    return this.getConfig()
  }

  // ── 路径解析 ────────────────────────────────

  /** 桥接脚本所在目录：dev = 插件根目录（deskpet-app 上一级），打包 = resources/bridges */
  private bridgesRoot(): string | null {
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, 'bridges')]
      : [path.resolve(app.getAppPath(), '..')]
    for (const dir of candidates) {
      try {
        if (fs.statSync(path.join(dir, 'stt-bridge.py')).isFile()) return dir
      } catch { /* try next */ }
    }
    return null
  }

  private gsvDir(): string | null {
    const configured = this.config.gsvDir.trim()
    const candidates = configured ? [configured] : GSV_CANDIDATES
    for (const dir of candidates) {
      try {
        if (fs.statSync(path.join(dir, 'runtime', 'python.exe')).isFile()) return dir
      } catch { /* try next */ }
    }
    return null
  }

  /** 仅用户在主进程原生确认框批准的、本次连接的解释器。 */
  private detectedPython: string | null = null
  private runtimeCandidate: RuntimeCandidate | null = null
  private candidateSequence = 0
  private runtimeFailures = new Map<ServiceId, 'missing-dependency'>()

  private python(): string {
    const configured = this.config.pythonPath.trim()
    return configured || this.detectedPython || 'python'
  }

  getRuntimeCandidate(): RuntimeCandidate | null {
    return this.runtimeCandidate ? { ...this.runtimeCandidate } : null
  }

  /** WS 只能提交待审核候选，绝不凭一帧消息执行程序。 */
  setDetectedPython(pythonPath: unknown, sourceUrl: unknown): void {
    if (this.quitting) return
    const result = validateDetectedPython(pythonPath, sourceUrl)
    if (!result.ok) {
      this.clearDetectedPython()
      return
    }
    if (this.runtimeCandidate?.pythonPath === result.pythonPath &&
        this.runtimeCandidate.sourceUrl === result.sourceUrl) return
    // 已批准的同一路径在同一连接重复上报时无需反复确认。
    if (this.detectedPython === result.pythonPath && this.approvedSource === result.sourceUrl) return
    this.clearDetectedPython()
    this.runtimeCandidate = {
      id: String(++this.candidateSequence), pythonPath: result.pythonPath, sourceUrl: result.sourceUrl,
    }
    this.pushAllStates()
  }

  private approvedSource: string | null = null

  /** 只由主进程确认处理器调用；renderer 没有绕过确认的直接入口。 */
  approveDetectedPython(id: string): boolean {
    const candidate = this.runtimeCandidate
    if (this.quitting || !candidate || candidate.id !== id) return false
    const result = validateDetectedPython(candidate.pythonPath, candidate.sourceUrl)
    if (!result.ok || result.pythonPath !== candidate.pythonPath || result.sourceUrl !== candidate.sourceUrl) {
      this.clearDetectedPython()
      return false
    }
    this.detectedPython = result.pythonPath
    this.approvedSource = result.sourceUrl
    this.runtimeCandidate = null
    this.pushAllStates()
    // 显式指定优先；只对确定的环境类失败补一次，不重启已运行或用户停止的服务。
    if (!this.config.pythonPath.trim()) {
      for (const def of this.defs()) {
        if (def.id === 'gpt-sovits' || def.id === 'hotkey' || !this.config.autoStart[def.id] || this.processes.has(def.id)) continue
        if (this.status.get(def.id) !== 'error') continue
        const missingRuntime = /ENOENT|找不到可执行文件/.test(this.detail.get(def.id) ?? '')
        if (missingRuntime || this.runtimeFailures.get(def.id) === 'missing-dependency') {
          this.appendLog(def.id, '[launcher] 本机解释器已由用户确认，重试环境类启动失败')
          void this.start(def.id)
        }
      }
    }
    return true
  }

  /** 断线/刷新使未决审核与自动解释器授权失效，不停止已运行服务。 */
  clearDetectedPython(): void {
    const hadRuntime = this.detectedPython !== null
    this.detectedPython = null
    this.approvedSource = null
    this.runtimeCandidate = null
    this.candidateSequence++
    if (hadRuntime && !this.config.pythonPath.trim()) {
      for (const id of this.starts.keys()) {
        if (id === 'gpt-sovits' || id === 'hotkey' || this.processes.has(id)) continue
        this.nextGeneration(id)
        this.starts.delete(id)
        this.setStatus(id, 'stopped', '连接已失效，取消使用自动发现解释器的待启动任务')
      }
    }
    this.pushAllStates()
  }

  /** Python 输出强制 UTF-8，否则 Windows 上中文日志按 GBK 编码全是乱码 */
  private pythonEnv(): Record<string, string> {
    return { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  }

  private defs(): ServiceDef[] {
    return [
      {
        id: 'stt-bridge',
        name: 'STT 语音识别桥',
        port: 18530,
        resolve: () => {
          const root = this.bridgesRoot()
          if (!root) return { unavailable: '未找到 stt-bridge.py（插件目录缺失）' }
          const env: Record<string, string> = {
            ...this.pythonEnv(),
            DESKPET_USER_SENSEVOICE_DIR: path.join(app.getPath('userData'), 'sensevoice'),
          }
          // 若旧版安装包目录中仍存在随包 sensevoice，也一并作为候选目录透传
          const packagedModel = path.join(root, 'sensevoice')
          if (app.isPackaged && fs.existsSync(packagedModel)) env.DESKPET_SENSEVOICE_DIR = packagedModel
          return { command: this.python(), args: ['-u', path.join(root, 'stt-bridge.py')], cwd: root, env }
        },
      },
      {
        id: 'tts-bridge',
        name: 'TTS 合成桥',
        port: 9881,
        resolve: () => {
          const root = this.bridgesRoot()
          if (!root) return { unavailable: '未找到 gpt-sovits-bridge.py（插件目录缺失）' }
          const env: Record<string, string> = { ...this.pythonEnv() }
          // 角色声线透传给桥脚本（与桥脚本认的环境变量名一一对应）
          const refAudio = this.config.ttsRefAudio.trim()
          if (refAudio) env.DESKPET_GSV_REF_AUDIO = refAudio
          const promptText = this.config.ttsPromptText.trim()
          if (promptText) env.DESKPET_GSV_PROMPT_TEXT = promptText
          return { command: this.python(), args: ['-u', path.join(root, 'gpt-sovits-bridge.py')], cwd: root, env }
        },
      },
      {
        id: 'cloud-tts',
        name: '云 TTS 桥',
        port: 9882,
        resolve: () => {
          const root = this.bridgesRoot()
          if (!root) return { unavailable: '未找到 cloud-tts-bridge.py（插件目录缺失）' }
          const backend = this.config.ttsBackend.trim().toLowerCase()
          const validCloud = ['siliconflow', 'cosyvoice', 'mimo', 'fishaudio', 'gsv2p', 'openai']
          if (!validCloud.includes(backend)) {
            return { unavailable: '未配置云 TTS 后端' }
          }
          const apiKey = this.config.ttsApiKey.trim()
          if (!apiKey && backend !== 'openai') {
            return { unavailable: '未配置云 TTS API Key（在下方填写后启动）' }
          }
          const env: Record<string, string> = {
            ...this.pythonEnv(),
            DESKPET_TTS_BACKEND: backend,
          }
          if (apiKey) {
            env.DESKPET_TTS_API_KEY = apiKey
            if (backend === 'mimo') env.DESKPET_MIMO_API_KEY = apiKey
            else if (backend === 'cosyvoice') env.DESKPET_COSYVOICE_API_KEY = apiKey
            else if (backend === 'gsv2p') env.DESKPET_GSV2P_TOKEN = apiKey
            else if (backend === 'siliconflow') env.DESKPET_SILICONFLOW_API_KEY = apiKey
            else if (backend === 'fishaudio') env.DESKPET_FISHAUDIO_API_KEY = apiKey
          }
          const voice = (this.config.ttsVoice || '').trim()
          if (voice) {
            env.DESKPET_TTS_VOICE = voice
            if (backend === 'mimo') env.DESKPET_MIMO_VOICE = voice
            else if (backend === 'cosyvoice') env.DESKPET_COSYVOICE_VOICE = voice
            else if (backend === 'gsv2p') env.DESKPET_GSV2P_VOICE = voice
          }
          const model = (this.config.ttsModel || '').trim()
          if (model) {
            env.DESKPET_TTS_MODEL = model
            if (backend === 'cosyvoice') env.DESKPET_COSYVOICE_MODEL = model
          }
          const endpoint = (this.config.ttsEndpoint || '').trim()
          if (endpoint) {
            env.DESKPET_TTS_ENDPOINT = endpoint
            if (backend === 'cosyvoice') env.DESKPET_COSYVOICE_ENDPOINT = endpoint
          }
          return { command: this.python(), args: ['-u', path.join(root, 'cloud-tts-bridge.py')], cwd: root, env }
        },
      },
      {
        id: 'gpt-sovits',
        name: 'GPT-SoVITS API',
        port: 9880,
        resolve: () => {
          const dir = this.gsvDir()
          if (!dir) return { unavailable: '未找到 GPT-SoVITS 整合包，在下方填写目录后重试' }
          return { command: path.join(dir, 'runtime', 'python.exe'), args: ['api_v2.py', '-p', '9880'], cwd: dir }
        },
      },
      {
        id: 'hotkey',
        name: 'PTT 热键监听',
        port: 0, // 无端口本地服务：基于 Win32 GetAsyncKeyState 只读监听，stdout 即事件通道
        resolve: () => {
          const key = this.config.pttKey.trim()
          if (!key) return { unavailable: '未配置 PTT 热键（设置面板 → 麦克风里设置）' }
          const vk = resolveHotkeyVirtualKey(key)
          if (vk === null) {
            return {
              unavailable: `不支持的 PTT 热键: ${key}（支持 f1..f24、mouse4/mouse5/mouse3、scroll_lock、pause、caps_lock、print_screen、insert、单字符）`,
            }
          }
          return {
            command: 'powershell.exe',
            args: [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-Command',
              buildWin32HotkeyScript(vk, key),
            ],
            cwd: app.getAppPath(),
          }
        },
      },
    ]
  }

  // ── 状态与日志 ──────────────────────────────

  list(): ServiceState[] {
    return this.defs().map((def) => {
      const resolved = def.resolve()
      return {
        id: def.id,
        name: def.name,
        port: def.port,
        status: this.status.get(def.id) ?? 'stopped',
        pid: this.processes.get(def.id)?.pid ?? null,
        detail: 'unavailable' in resolved ? resolved.unavailable : (this.detail.get(def.id) ?? ''),
        available: !('unavailable' in resolved),
        showTerminal: this.config.showTerminal[def.id],
        autoStart: this.config.autoStart[def.id],
      }
    })
  }

  logsOf(id: ServiceId): string[] {
    return this.logs.get(id) ?? []
  }

  private setStatus(id: ServiceId, status: ServiceStatus, detail = ''): void {
    this.status.set(id, status)
    this.detail.set(id, detail)
    this.pushAllStates()
  }

  private pushAllStates(): void {
    this.emit('services-update', this.list())
  }

  private appendLog(id: ServiceId, chunk: string): void {
    const lines = chunk.split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length === 0) return
    const buf = this.logs.get(id) ?? []
    buf.push(...lines)
    if (buf.length > LOG_LIMIT) buf.splice(0, buf.length - LOG_LIMIT)
    this.logs.set(id, buf)
    this.emit('service-log', { id, lines })
  }

  /**
   * hotkey 桥的 stdout 是事件流而不是普通日志：PTT_DOWN/PTT_UP 独占一行，
   * 解析出来经 emit 转发渲染层，其余行进日志面板。
   */
  private handleServiceOutput(id: ServiceId, proc: ChildProcess, chunk: string, active: boolean): void {
    if (id !== 'hotkey') {
      this.appendProcessLog(id, proc, chunk)
      return
    }
    const buf = (this.lineBuffers.get(proc) ?? '') + chunk
    const lines = buf.split(/\r?\n/)
    this.lineBuffers.set(proc, lines.pop() ?? '')
    const logs: string[] = []
    for (const line of lines) {
      if (line === 'PTT_DOWN') {
        if (active && !this.pttHeld.has(proc)) {
          this.pttHeld.add(proc)
          this.emit('ptt-event', 'down')
        }
      } else if (line === 'PTT_UP') {
        if (active && this.pttHeld.delete(proc)) this.emit('ptt-event', 'up')
      } else if (line) logs.push(line)
    }
    if (logs.length > 0) this.appendProcessLog(id, proc, logs.join('\n'))
  }

  private appendProcessLog(id: ServiceId, proc: ChildProcess, chunk: string): void {
    const prefix = this.processes.get(id) === proc ? '' : `[已退出实例 ${proc.pid ?? '?'}] `
    this.appendLog(id, prefix + chunk)
  }

  private cancelPtt(id: ServiceId, proc: ChildProcess): void {
    if (id !== 'hotkey' || this.pttCancelled.has(proc)) return
    this.pttCancelled.add(proc)
    this.pttHeld.delete(proc)
    // cancel 不等于松开：前端必须丢弃半截录音，不能自动发送。
    if (!this.quitting) this.emit('ptt-event', 'cancel')
  }

  // ── 生命周期 ────────────────────────────────

  private nextGeneration(id: ServiceId): number {
    const generation = (this.generations.get(id) ?? 0) + 1
    this.generations.set(id, generation)
    return generation
  }

  private cancelRestart(id: ServiceId): void {
    const pending = this.restarts.get(id)
    if (pending) clearTimeout(pending.timer)
    this.restarts.delete(id)
  }

  private isCurrentStart(id: ServiceId, generation: number): boolean {
    return !this.quitting && this.generations.get(id) === generation
  }

  /**
   * 终端窗口模式：Node spawn 不给 console 子进程开新控制台（GUI 父进程 + 无
   * CREATE_NEW_CONSOLE），必须走 cmd start —— start 必然拉出新控制台窗口；
   * /wait 让外层 cmd 挂到 python 退出才走，进程树跟踪与 taskkill 语义不变。
   * 另外 MaiBot 一键包常给的是 pythonw.exe（永远无控制台），自动换同目录 python.exe。
   */
  private spawnTerminal(
    resolved: { command: string; args: string[]; cwd: string; env?: Record<string, string> },
    title: string,
  ): ChildProcess {
    let command = resolved.command
    if (/pythonw\.exe$/i.test(command)) {
      const sibling = command.replace(/pythonw\.exe$/i, 'python.exe')
      try {
        if (fs.statSync(sibling).isFile()) command = sibling
      } catch { /* 没有同目录 python.exe 就照旧 */ }
    }
    return spawn(
      'cmd.exe',
      [
        '/c', 'start', `"${title}"`, '/wait', '/D', `"${resolved.cwd}"`,
        command, ...resolved.args.map((a) => (a.includes(' ') ? `"${a}"` : a)),
      ],
      {
        cwd: resolved.cwd,
        env: { ...process.env, ...(resolved.env ?? {}), DESKPET_PARENT_PID: String(process.pid) },
        // 外层 cmd 藏起来；python 的控制台窗口由 start 创建
        windowsHide: true,
        stdio: 'ignore',
      },
    )
  }

  start(id: ServiceId): Promise<void> {
    if (this.quitting || this.processes.has(id)) return Promise.resolve()
    const existing = this.starts.get(id)
    if (existing) return existing
    const generation = this.nextGeneration(id)
    // 延后一微任务：第一个 await/状态通知发生前先登记单飞锁。
    const task = Promise.resolve().then(() => this.startProcess(id, generation)).finally(() => {
      if (this.starts.get(id) === task) this.starts.delete(id)
    })
    this.starts.set(id, task)
    return task
  }

  private async startProcess(id: ServiceId, generation: number): Promise<void> {
    if (!this.isCurrentStart(id, generation)) return
    const def = this.defs().find((d) => d.id === id)
    if (!def) return
    const resolved = def.resolve()
    if ('unavailable' in resolved) {
      this.setStatus(id, 'error', resolved.unavailable)
      return
    }

    this.setStatus(id, 'starting', '检查启动条件')
    try {
      if (def.port > 0) {
        const occupied = await this.probePort(def.port)
        if (!this.isCurrentStart(id, generation)) return
        if (occupied) {
          // 端口不是所有权凭据。保留外部服务，由用户选择使用或手动停止。
          this.setStatus(id, 'error', `端口 ${def.port} 已被占用，未启动新进程；现有服务未被终止`)
          return
        }
      }
    } catch (err) {
      if (this.isCurrentStart(id, generation)) this.setStatus(id, 'error', `无法确认端口是否可用: ${err}`)
      return
    }
    if (!this.isCurrentStart(id, generation)) return

    const showTerminal = id !== 'hotkey' && this.config.showTerminal[id]
    this.appendLog(id, `[launcher] ${resolved.command} ${resolved.args.join(' ')}`)
    if (!this.isCurrentStart(id, generation)) return
    let proc: ChildProcess
    try {
      proc = showTerminal
        ? this.spawnTerminal(resolved, def.name)
        : spawn(resolved.command, resolved.args, {
            cwd: resolved.cwd,
            env: { ...process.env, ...(resolved.env ?? {}), DESKPET_PARENT_PID: String(process.pid) },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
    } catch (err) {
      this.setStatus(id, 'error', `启动失败: ${err}`)
      return
    }

    this.processes.set(id, proc)
    this.runtimeFailures.delete(id)
    let startupStderr = ''
    const isCurrent = () => !this.quitting && this.processes.get(id) === proc
    let outputClosed = false
    proc.stdout?.setEncoding('utf-8')
    proc.stderr?.setEncoding('utf-8')
    proc.stdout?.on('data', (chunk: string) => {
      if (outputClosed || this.quitting) return
      const active = isCurrent() && this.generations.get(id) === generation && !this.pttCancelled.has(proc)
      this.handleServiceOutput(id, proc, chunk, active)
    })
    proc.stderr?.on('data', (chunk: string) => {
      startupStderr = (startupStderr + chunk).slice(-8192)
      if (!outputClosed && !this.quitting) this.appendProcessLog(id, proc, chunk)
    })
    // exit 不保证 stdio 已排空：日志保留到 close，旧实例控制事件则绝不再转发。
    proc.on('close', () => {
      outputClosed = true
      const tail = this.lineBuffers.get(proc)
      if (tail && !this.quitting && tail !== 'PTT_DOWN' && tail !== 'PTT_UP') this.appendProcessLog(id, proc, tail)
      this.lineBuffers.delete(proc)
    })

    proc.on('error', (err) => {
      if (!isCurrent()) return
      const hint = /ENOENT/.test(String(err)) ? '（找不到可执行文件，检查 Python 路径）' : ''
      // spawn 失败没有 PID；已有 PID 的 error 不等于退出，不能丢掉所有权。
      if (proc.pid == null) {
        this.finishProcess(id, proc, 'error', `${err}${hint}`)
      } else {
        this.cancelRestart(id)
        this.stopping.delete(proc)
        this.setStatus(id, 'error', `进程操作失败（仍保留进程句柄）: ${err}`)
      }
    })
    proc.on('exit', (code) => {
      if (!isCurrent()) return
      const stopped = this.stopping.has(proc)
      if (!stopped && code !== 0 && /ModuleNotFoundError|ImportError[^\n]*(?:No module named|cannot import name)/.test(startupStderr)) {
        this.runtimeFailures.set(id, 'missing-dependency')
      }
      this.finishProcess(id, proc, stopped || code === 0 ? 'stopped' : 'error',
        stopped ? '' : code === 0 ? '进程自行退出' : `进程异常退出 (code ${code})，看日志排查`)
    })

    this.setStatus(id, 'starting')
    this.ensureProbeLoop()
  }

  private finishProcess(id: ServiceId, proc: ChildProcess, status: ServiceStatus, detail: string): void {
    if (this.processes.get(id) !== proc) return
    this.cancelPtt(id, proc)
    this.processes.delete(id)
    this.stopping.delete(proc)
    this.starts.delete(id)
    const pending = this.restarts.get(id)
    const shouldRestart = pending?.proc === proc && this.isCurrentStart(id, pending.generation)
    this.cancelRestart(id)
    this.setStatus(id, status, detail)
    if (shouldRestart) void this.start(id)
  }

  stop(id: ServiceId): void {
    this.nextGeneration(id) // 取消正在检查端口、尚未 spawn 的启动任务。
    this.starts.delete(id)
    this.cancelRestart(id)
    const proc = this.processes.get(id)
    if (!proc) {
      this.setStatus(id, 'stopped')
      return
    }
    this.cancelPtt(id, proc)
    if (this.stopping.has(proc)) return
    const attempt = {}
    this.stopping.set(proc, attempt)
    if (proc.pid == null) return // 等待 spawn 的 error/exit 事件统一收尾。
    // 只结束本实例 spawn 并且仍持有句柄的进程，不按端口猜测 PID。
    execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, (err) => {
      if (!err || this.quitting || this.processes.get(id) !== proc || this.stopping.get(proc) !== attempt) return
      this.stopping.delete(proc)
      // taskkill 失败可能只是目标已自行退出，仍等真实 exit；超时/显式 stop 才撤销重启。
      this.setStatus(id, 'error', `停止命令失败，等待确认退出；尚未启动替代进程: ${err.message}`)
    })
  }

  restart(id: ServiceId): void {
    if (this.quitting) return
    this.stop(id)
    const proc = this.processes.get(id)
    if (!proc) {
      void this.start(id)
      return
    }
    if (!this.stopping.has(proc)) return
    const generation = this.generations.get(id)!
    const timer = setTimeout(() => {
      const pending = this.restarts.get(id)
      if (pending?.generation !== generation || pending.proc !== proc) return
      this.cancelRestart(id)
      if (this.processes.get(id) === proc) {
        this.stopping.delete(proc) // 允许用户再次停止；旧 taskkill 回调已失效。
        this.setStatus(id, 'error', '等待进程退出超时，已取消自动重启；可重试停止')
      }
    }, 10_000)
    this.restarts.set(id, { proc, generation, timer })
  }

  autoStartAll(): void {
    for (const def of this.defs()) {
      if (!this.config.autoStart[def.id]) continue
      const resolved = def.resolve()
      if ('unavailable' in resolved) {
        this.appendLog(def.id, `[launcher] 跳过自启：${resolved.unavailable}`)
        continue
      }
      this.start(def.id)
    }
  }

  /** 应用退出时同步杀掉所有子进程树（不能等异步回调，quit 不会等我们） */
  stopAllSync(): void {
    this.quitting = true
    for (const id of this.restarts.keys()) this.cancelRestart(id)
    this.starts.clear() // isCurrentStart 会让在途端口检查失效，退出后不再 spawn。
    if (this.probeTimer) { clearInterval(this.probeTimer); this.probeTimer = null }
    for (const proc of this.processes.values()) {
      if (proc.pid != null) {
        try {
          execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
            stdio: 'ignore', windowsHide: true, timeout: 5000,
          })
        } catch { /* 进程可能已经没了；桥自身的 watchdog 仍会兜底。 */ }
      }
    }
    this.processes.clear()
    this.stopping.clear()
    this.lineBuffers.clear()
  }

  // ── 健康探测 ────────────────────────────────

  private ensureProbeLoop(): void {
    if (this.probeTimer) return
    this.probeTimer = setInterval(() => {
      if (this.processes.size === 0) {
        clearInterval(this.probeTimer!)
        this.probeTimer = null
        return
      }
      let hasStarting = false
      for (const def of this.defs()) {
        const proc = this.processes.get(def.id)
        if (!proc || this.stopping.has(proc)) continue
        if (this.status.get(def.id) !== 'starting') continue
        const generation = this.generations.get(def.id)
        if (def.port === 0) {
          // 无端口服务（hotkey 桥）：进程在跑且没退出就算 running
          this.setStatus(def.id, 'running')
          continue
        }
        hasStarting = true
        this.probePort(def.port).then((open) => {
          if (this.quitting || this.processes.get(def.id) !== proc ||
              this.generations.get(def.id) !== generation || this.stopping.has(proc)) return
          const current = this.status.get(def.id)
          if (open && current === 'starting') this.setStatus(def.id, 'running')
          // 端口关了但进程还在：保留所有权，交给 exit 事件定性。
        }).catch(() => { /* 不确定的探测不能确认运行健康。 */ })
      }
      if (!hasStarting && this.probeTimer) {
        clearInterval(this.probeTimer)
        this.probeTimer = null
      }
    }, PROBE_INTERVAL_MS)
  }

  private probePort(port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ port, host: '127.0.0.1' })
      let settled = false
      const done = (result: boolean, error?: Error) => {
        if (settled) return
        settled = true
        socket.destroy()
        if (error) reject(error)
        else resolve(result)
      }
      socket.setTimeout(1500)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false, new Error(`端口 ${port} 探测超时`)))
      socket.once('error', (error: NodeJS.ErrnoException) => {
        done(false, error.code === 'ECONNREFUSED' ? undefined : error)
      })
    })
  }
}

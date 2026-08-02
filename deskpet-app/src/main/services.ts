/**
 * 后台服务管理器 —— 取代 start.bat 的"一键启动"
 *
 * 管理三个子进程：STT 桥（SenseVoice）、TTS 桥（GPT-SoVITS 中继）、GPT-SoVITS API。
 * MaiBot 本体不归它管（独立的 OneKey 安装），前端只做连通性显示。
 *
 * 每个服务两种运行模式（对应"可选终端显示"）：
 *   - 隐藏模式（默认）：stdout/stderr 进环形日志缓冲，通过 IPC 推给设置面板
 *   - 终端模式：windowsHide=false 让 python.exe 自带控制台窗口，日志在窗口里看
 * 两种模式下进程句柄都在我们手里，退出时统一 taskkill /T 杀进程树。
 */
import { spawn, exec, ChildProcess } from 'child_process'
import net from 'net'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

export type ServiceId = 'stt-bridge' | 'tts-bridge' | 'gpt-sovits' | 'hotkey'
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
  autoStart: Record<ServiceId, boolean>
  showTerminal: Record<ServiceId, boolean>
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
  autoStart: { 'stt-bridge': true, 'tts-bridge': true, 'gpt-sovits': true, hotkey: true },
  showTerminal: { 'stt-bridge': false, 'tts-bridge': false, 'gpt-sovits': false, hotkey: false },
}

const GSV_CANDIDATES = [
  'D:\\GPT-SoVITS-v2pro-20250604',
  'C:\\GPT-SoVITS-v2pro-20250604',
  path.join(process.env.USERPROFILE || '', 'GPT-SoVITS-v2pro-20250604'),
]

export class ServiceManager {
  private config: ServicesConfig
  private processes = new Map<ServiceId, ChildProcess>()
  private status = new Map<ServiceId, ServiceStatus>()
  private detail = new Map<ServiceId, string>()
  private logs = new Map<ServiceId, string[]>()
  /** 用户主动 stop 的进程退出不算 error */
  private stopping = new Set<ServiceId>()
  /** stdout 按行解析时的跨 chunk 余量（事件行可能被两次 data 事件切断） */
  private lineBuffers = new Map<ServiceId, string>()
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
      const raw = JSON.parse(fs.readFileSync(this.configPath(), 'utf-8')) as Partial<ServicesConfig>
      return {
        pythonPath: typeof raw.pythonPath === 'string' ? raw.pythonPath : '',
        gsvDir: typeof raw.gsvDir === 'string' ? raw.gsvDir : '',
        ttsRefAudio: typeof raw.ttsRefAudio === 'string' ? raw.ttsRefAudio : '',
        ttsPromptText: typeof raw.ttsPromptText === 'string' ? raw.ttsPromptText : '',
        pttKey: typeof raw.pttKey === 'string' ? raw.pttKey : 'f9',
        autoStart: { ...DEFAULT_CONFIG.autoStart, ...(raw.autoStart ?? {}) },
        showTerminal: { ...DEFAULT_CONFIG.showTerminal, ...(raw.showTerminal ?? {}) },
      }
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    }
  }

  getConfig(): ServicesConfig {
    return JSON.parse(JSON.stringify(this.config))
  }

  setConfig(patch: Partial<ServicesConfig>): ServicesConfig {
    if (typeof patch.pythonPath === 'string') this.config.pythonPath = patch.pythonPath
    if (typeof patch.gsvDir === 'string') this.config.gsvDir = patch.gsvDir
    if (typeof patch.ttsRefAudio === 'string') this.config.ttsRefAudio = patch.ttsRefAudio
    if (typeof patch.ttsPromptText === 'string') this.config.ttsPromptText = patch.ttsPromptText
    if (typeof patch.pttKey === 'string') this.config.pttKey = patch.pttKey
    if (patch.autoStart) this.config.autoStart = { ...this.config.autoStart, ...patch.autoStart }
    if (patch.showTerminal) this.config.showTerminal = { ...this.config.showTerminal, ...patch.showTerminal }
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true })
      fs.writeFileSync(this.configPath(), JSON.stringify(this.config, null, 2), 'utf-8')
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

  /**
   * 桌宠连上 MaiBot 后，插件上报的 Python 解释器路径（sys.executable，内存态不持久化，
   * 每次 WS 连接都会重新上报）。桥脚本复用 MaiBot 的 Python 环境 —— 插件依赖
   * 就装在同一个环境里，用户无需单独安装 Python。
   */
  private detectedPython: string | null = null

  /**
   * Python 解析顺序：设置面板显式指定 > MaiBot 插件上报 > 系统 PATH。
   */
  private python(): string {
    const configured = this.config.pythonPath.trim()
    if (configured) return configured
    return this.detectedPython ?? 'python'
  }

  /** WS 连上 MaiBot 后由渲染层转发过来；对因找不到 Python 而失败的服务补一次启动 */
  setDetectedPython(pythonPath: string): void {
    if (typeof pythonPath !== 'string' || !pythonPath.trim()) return
    if (this.detectedPython === pythonPath) return
    this.detectedPython = pythonPath.trim()
    console.info(`[services] MaiBot python detected: ${this.detectedPython}`)
    for (const def of this.defs()) {
      if (def.id === 'gpt-sovits') continue // 用整合包自带 runtime，与此无关
      if (!this.config.autoStart[def.id]) continue
      const failedForMissingPython =
        this.status.get(def.id) === 'error' && /ENOENT|找不到可执行文件/.test(this.detail.get(def.id) ?? '')
      if (failedForMissingPython) {
        this.appendLog(def.id, `[launcher] 拿到 MaiBot Python 路径，重试启动`)
        this.start(def.id)
      }
    }
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
          const env: Record<string, string> = { ...this.pythonEnv() }
          // 打包模式下 SenseVoice 模型跟着 bridges 走，通过 env 告诉脚本
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
        name: 'PTT 热键桥',
        port: 0, // 无端口服务：stdout 即事件通道
        resolve: () => {
          const root = this.bridgesRoot()
          if (!root) return { unavailable: '未找到 hotkey-bridge.py（插件目录缺失）' }
          const key = this.config.pttKey.trim()
          if (!key) return { unavailable: '未配置 PTT 热键（设置面板 → 麦克风里设置）' }
          return {
            command: this.python(),
            args: ['-u', path.join(root, 'hotkey-bridge.py')],
            cwd: root,
            env: { ...this.pythonEnv(), DESKPET_PTT_KEY: key },
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
  private handleServiceOutput(id: ServiceId, chunk: string): void {
    if (id !== 'hotkey') {
      this.appendLog(id, chunk)
      return
    }
    const buf = (this.lineBuffers.get(id) ?? '') + chunk
    const lines = buf.split(/\r?\n/)
    this.lineBuffers.set(id, lines.pop() ?? '') // 末段可能不完整，留给下个 chunk
    const logs: string[] = []
    for (const line of lines) {
      if (line === 'PTT_DOWN') this.emit('ptt-event', 'down')
      else if (line === 'PTT_UP') this.emit('ptt-event', 'up')
      else if (line) logs.push(line)
    }
    if (logs.length > 0) this.appendLog(id, logs.join('\n'))
  }

  // ── 生命周期 ────────────────────────────────

  start(id: ServiceId): void {
    if (this.processes.has(id)) return
    const def = this.defs().find((d) => d.id === id)
    if (!def) return
    const resolved = def.resolve()
    if ('unavailable' in resolved) {
      this.setStatus(id, 'error', resolved.unavailable)
      return
    }

    const showTerminal = this.config.showTerminal[id]
    this.appendLog(id, `[launcher] ${resolved.command} ${resolved.args.join(' ')}`)

    let proc: ChildProcess
    try {
      proc = spawn(resolved.command, resolved.args, {
        cwd: resolved.cwd,
        // 把桌宠主进程 PID 传给桥：桥的看门狗轮询它，一旦消失就自杀，
        // 保证桌宠无论正常退出 / 崩溃 / 被任务管理器强杀，桥都不残留
        env: { ...process.env, ...(resolved.env ?? {}), DESKPET_PARENT_PID: String(process.pid) },
        // 终端模式：python.exe 是控制台程序，不加 CREATE_NO_WINDOW 就会带出自己的控制台窗口
        windowsHide: !showTerminal,
        // 终端模式：输出留给控制台窗口；隐藏模式：接管进日志缓冲
        stdio: showTerminal ? 'ignore' : ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      this.setStatus(id, 'error', `启动失败: ${err}`)
      return
    }

    this.processes.set(id, proc)
    this.stopping.delete(id)
    this.setStatus(id, 'starting')

    proc.stdout?.setEncoding('utf-8')
    proc.stderr?.setEncoding('utf-8')
    proc.stdout?.on('data', (chunk: string) => this.handleServiceOutput(id, chunk))
    proc.stderr?.on('data', (chunk: string) => this.appendLog(id, chunk))

    proc.on('error', (err) => {
      this.processes.delete(id)
      this.lineBuffers.delete(id)
      const hint = /ENOENT/.test(String(err)) ? '（找不到可执行文件，检查 Python 路径）' : ''
      this.setStatus(id, 'error', `${err}${hint}`)
    })

    proc.on('exit', (code) => {
      this.processes.delete(id)
      this.lineBuffers.delete(id)
      if (this.stopping.has(id)) {
        this.stopping.delete(id)
        this.setStatus(id, 'stopped')
      } else if (code === 0) {
        this.setStatus(id, 'stopped', '进程自行退出')
      } else {
        this.setStatus(id, 'error', `进程异常退出 (code ${code})，看日志排查`)
      }
    })

    this.ensureProbeLoop()
  }

  stop(id: ServiceId): void {
    const proc = this.processes.get(id)
    if (!proc || proc.pid == null) return
    this.stopping.add(id)
    // GPT-SoVITS 的 runtime\python 会再拉子进程，必须整树杀干净
    exec(`taskkill /pid ${proc.pid} /T /F`, () => { /* exit 事件里统一收尾 */ })
  }

  restart(id: ServiceId): void {
    const proc = this.processes.get(id)
    if (!proc) {
      this.start(id)
      return
    }
    const once = (state: ServiceState[]) => {
      const entry = state.find((s) => s.id === id)
      if (entry && entry.status !== 'starting' && entry.status !== 'running') {
        this.start(id)
        return true
      }
      return false
    }
    // 简单轮询等退出完成再拉起（exit 事件驱动 pushAllStates，这里不重复接线）
    this.stop(id)
    const timer = setInterval(() => {
      if (once(this.list())) clearInterval(timer)
    }, 300)
    setTimeout(() => clearInterval(timer), 10_000)
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
    if (this.probeTimer) { clearInterval(this.probeTimer); this.probeTimer = null }
    for (const [id, proc] of this.processes) {
      this.stopping.add(id)
      if (proc.pid != null) {
        try {
          require('child_process').execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore', timeout: 5000 })
        } catch { /* 进程可能已经没了 */ }
      }
    }
    this.processes.clear()
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
      for (const def of this.defs()) {
        if (!this.processes.has(def.id)) continue
        if (def.port === 0) {
          // 无端口服务（hotkey 桥）：进程在跑且没退出就算 running
          if (this.status.get(def.id) === 'starting') this.setStatus(def.id, 'running')
          continue
        }
        this.probePort(def.port).then((open) => {
          const current = this.status.get(def.id)
          if (open && current === 'starting') this.setStatus(def.id, 'running')
          // 端口关了但进程还在：保持 starting/running 不动，交给 exit 事件定性
        })
      }
    }, PROBE_INTERVAL_MS)
  }

  private probePort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' })
      const done = (result: boolean) => {
        socket.destroy()
        resolve(result)
      }
      socket.setTimeout(1500)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false))
      socket.once('error', () => done(false))
    })
  }
}

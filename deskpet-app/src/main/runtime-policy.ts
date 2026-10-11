/**
 * 运行时策略 —— 对“检测到的 Python 解释器”与“MaiBot WS 来源”做只读候选校验。
 *
 * 插件通过 WS 上报 MaiBot 的 sys.executable 与连接来源；本模块绝不自动信任这些值，
 * 也不执行任何 Python、不启动任何进程 —— 只读取文件系统元信息（realpath/stat），
 * 通过后返回可供用户在设置面板审阅的候选值。
 *
 * 失败一律返回简短、且不包含输入内容的 reason，避免把路径、URL query 或 token
 * 泄漏进日志与 UI。
 */
import fs from 'fs'
import path from 'path'

export type RuntimeValidation =
  | { ok: true; pythonPath: string; sourceUrl: string }
  | { ok: false; reason: string }

/** 允许的解释器文件名（大小写不敏感）。 */
const ALLOWED_BASENAMES = new Set(['python.exe', 'pythonw.exe'])

/** 允许的 loopback 主机名（去掉 IPv6 方括号后小写）。 */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/** Windows 本地盘绝对路径前缀：C:\ 或 C:/。 */
const DRIVE_PREFIX = /^[A-Za-z]:[\\/]/

/** NUL、控制字符与 cmd / PowerShell 元字符。 */
const ILLEGAL_PATH_CHARS = /[\u0000-\u001f\u007f&|<>^%"!`'$;*?]/

/** 只接受 Windows 本地盘绝对路径：拒绝相对、UNC、设备命名空间与控制/元字符。 */
function isLocalDrivePath(value: string): boolean {
  if (!DRIVE_PREFIX.test(value)) return false
  if (value.startsWith('//') || value.startsWith('\\\\')) return false
  if (ILLEGAL_PATH_CHARS.test(value)) return false
  return true
}

/** basename 必须是 python.exe / pythonw.exe（大小写不敏感）。 */
function hasAllowedBasename(value: string): boolean {
  return ALLOWED_BASENAMES.has(path.basename(value).toLowerCase())
}

/** 去掉 IPv6 方括号并小写，便于与允许列表比较。 */
function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase()
  if (lower.startsWith('[') && lower.endsWith(']')) return lower.slice(1, -1)
  return lower
}

/**
 * 先校验来源地址，且只接受本机回环上的 ws: / wss:。
 * 返回规范化后的 origin + pathname（丢弃 query / hash，避免 token 泄漏），
 * 不合法时返回 null。
 */
function validateSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null
  if (url.username || url.password) return null
  if (!ALLOWED_HOSTS.has(normalizeHostname(url.hostname))) return null
  return `${url.origin}${url.pathname}`
}

export function validateDetectedPython(pythonPath: unknown, sourceUrl: unknown): RuntimeValidation {
  // ---- 第一步：来源必须是本机回环，否则直接拒绝，绝不触碰文件系统 ----
  const safeSource = validateSourceUrl(sourceUrl)
  if (safeSource === null) {
    return { ok: false, reason: '来源地址不是本机回环 ws/wss 地址' }
  }

  // ---- 第二步：Python 解释器只接受 Windows 本地盘绝对路径 ----
  if (typeof pythonPath !== 'string') {
    return { ok: false, reason: '未检测到 Python 路径' }
  }
  // 控制字符与 cmd / PowerShell 元字符在裁剪前就要拒绝：换行/回车会截断命令行
  if (ILLEGAL_PATH_CHARS.test(pythonPath)) {
    return { ok: false, reason: 'Python 路径包含非法字符' }
  }
  const candidate = pythonPath.trim()
  if (!candidate) {
    return { ok: false, reason: 'Python 路径为空' }
  }
  if (!isLocalDrivePath(candidate)) {
    return { ok: false, reason: 'Python 路径必须是本地盘绝对路径' }
  }
  if (!hasAllowedBasename(candidate)) {
    return { ok: false, reason: 'Python 可执行文件必须是 python.exe 或 pythonw.exe' }
  }

  // 只读取文件元信息（不执行任何进程）
  let resolved: unknown = null
  try {
    resolved = fs.realpathSync(candidate)
  } catch {
    return { ok: false, reason: 'Python 路径无法解析' }
  }
  if (typeof resolved !== 'string') {
    return { ok: false, reason: 'Python 路径无法解析' }
  }

  // realpath 之后必须仍是本地盘 + 合法 basename，防止符号链接跳转
  if (!isLocalDrivePath(resolved) || !hasAllowedBasename(resolved)) {
    return { ok: false, reason: 'Python 路径指向不安全的目标' }
  }

  let isFile = false
  try {
    isFile = fs.statSync(resolved).isFile()
  } catch {
    return { ok: false, reason: 'Python 路径无法读取' }
  }
  if (!isFile) {
    return { ok: false, reason: 'Python 路径不是普通文件' }
  }

  return { ok: true, pythonPath: resolved, sourceUrl: safeSource }
}
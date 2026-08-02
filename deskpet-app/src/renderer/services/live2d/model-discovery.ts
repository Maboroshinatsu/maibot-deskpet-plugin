/**
 * Live2D 模型发现
 *
 * 选取顺序：
 *   1. 用户在设置面板里选定的模型（localStorage: deskpet/model-path）
 *   2. model-config.ts 里的 MODEL_PATH（内置默认模型）
 *   3. 主进程扫描 public/models/ 得到的第一个 .model3.json
 *
 * 目录扫描交给主进程做（渲染层没有 fs），见 main/index.ts 的 list-models。
 */
import { MODEL_PATH } from '@/services/model-config'

export const MODEL_PATH_KEY = 'deskpet/model-path'

export type ModelKind = 'live2d' | 'image-set'

/** 由模型 URL 判定渲染路径：立绘包清单 vs Live2D model3.json */
export function kindOfModelUrl(url: string): ModelKind {
  return /deskpet-images\.json(\?|#|$)/i.test(url) ? 'image-set' : 'live2d'
}

let cachedModelUrl: string | null = null
let cachedModelList: ModelEntry[] | null = null

/**
 * 判断模型 URL 是否真的可加载。
 *
 * 不能用 HEAD 探测：dev 下 Vite 的 SPA 回退对任何路径都回 200（连不存在的也“存在”），
 * 打包后 file:// 页面的 fetch 又一律被拒（永远“不存在”）。
 * 主进程扫描出的模型清单才是可靠的存在性来源；清单拿不到时退回内容嗅探。
 */
async function modelUrlUsable(url: string): Promise<boolean> {
  const models = await listAvailableModels()
  if (models.some((m) => m.url === url)) return true

  // electronAPI 不可用（纯浏览器调试）时退回 GET + JSON 嗅探：
  // 真正的 .model3.json 以 { 开头，SPA 回退回来的是 HTML
  try {
    const resp = await fetch(url, { cache: 'no-cache' })
    if (!resp.ok) return false
    const text = await resp.text()
    return text.trimStart().startsWith('{')
  } catch {
    return false
  }
}

/**
 * 归一化模型路径，只接受渲染层真正能加载的相对 URL。
 *
 * 旧版设置面板是个自由输入框，很容易被填成绝对路径
 * （例如 D:\...\src\renderer\public\models\ariu_vts\ariu.model3.json）。
 * 这种值在 http:// 页面里永远加载不了（Electron 也会拦 file://），
 * 也就是说它从来没有真正生效过 —— 所以直接丢弃，而不是猜测用户想选哪个模型。
 */
export function normalizeModelPath(raw: string): string {
  const value = raw.trim().replace(/\\/g, '/')
  if (!value) return ''

  // 打包模式下主进程通过自定义协议提供模型，这类 URL 原样放行
  if (value.startsWith('deskpet://')) return value

  const isAbsolute = /^[a-zA-Z]:\//.test(value) || value.startsWith('/') || /^[a-z]+:\/\//i.test(value)
  if (isAbsolute) {
    console.warn(`[ModelDiscovery] Ignoring absolute model path (never loadable): ${raw}`)
    return ''
  }

  if (value.startsWith('./')) return value
  if (value.startsWith('models/')) return `./${value}`
  return `./${value.replace(/^\.?\//, '')}`
}

export function getStoredModelPath(): string {
  try {
    const raw = localStorage.getItem(MODEL_PATH_KEY) || ''
    if (!raw) return ''

    // 顺手把旧格式洗掉，免得每次启动都重复归一化和告警
    const normalized = normalizeModelPath(raw)
    if (!normalized) {
      localStorage.removeItem(MODEL_PATH_KEY)
    } else if (normalized !== raw) {
      localStorage.setItem(MODEL_PATH_KEY, normalized)
    }
    return normalized
  } catch {
    return ''
  }
}

export function setStoredModelPath(url: string): void {
  try {
    const normalized = normalizeModelPath(url)
    if (normalized) localStorage.setItem(MODEL_PATH_KEY, normalized)
    else localStorage.removeItem(MODEL_PATH_KEY)
  } catch {
    // localStorage 被禁用时静默失败，本次会话仍可正常切换
  }
}

/** 列出 public/models/ 下所有可用模型，供设置面板下拉框使用。 */
export async function listAvailableModels(forceRescan = false): Promise<ModelEntry[]> {
  if (cachedModelList && !forceRescan) return cachedModelList
  try {
    cachedModelList = (await window.electronAPI?.listModels()) ?? []
  } catch (err) {
    console.warn('[ModelDiscovery] list-models failed:', err)
    cachedModelList = []
  }
  return cachedModelList
}

export async function discoverModel(): Promise<string> {
  if (cachedModelUrl) return cachedModelUrl

  const stored = getStoredModelPath()
  if (stored && (await modelUrlUsable(stored))) {
    cachedModelUrl = stored
    return cachedModelUrl
  }
  if (stored) {
    // 清掉失效的值，否则每次启动都要走一遍回退并刷一条警告
    console.warn(`[ModelDiscovery] Stored model missing, discarding: ${stored}`)
    setStoredModelPath('')
  }

  if (await modelUrlUsable(MODEL_PATH)) {
    cachedModelUrl = MODEL_PATH
    return cachedModelUrl
  }
  console.warn(`[ModelDiscovery] Default model missing: ${MODEL_PATH}`)

  const models = await listAvailableModels(true)
  if (models.length > 0) {
    cachedModelUrl = models[0].url
    console.log(`[ModelDiscovery] Found model by scan: ${cachedModelUrl}`)
    return cachedModelUrl
  }

  console.warn('[ModelDiscovery] No model found in public/models/')
  console.warn('[ModelDiscovery] Expected structure: public/models/<name>/<name>.model3.json')
  return ''
}

export function clearModelCache(): void {
  cachedModelUrl = null
  cachedModelList = null
}

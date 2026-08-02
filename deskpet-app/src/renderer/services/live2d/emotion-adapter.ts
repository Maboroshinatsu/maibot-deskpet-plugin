/** 内置情绪词表；模型（adapter / 立绘包清单）还可以声明任意自定义情绪键 */
export const DESKPET_EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'surprise',
  'embarrassed',
  'thinking',
  'shy',
  'curious',
  'confused',
  'neutral',
  'idle'
] as const

export type DeskpetEmotion = typeof DESKPET_EMOTIONS[number]

export interface EmotionMotionTarget {
  group: string
  index?: number
}

export interface EmotionTarget {
  expression?: string
  motion?: EmotionMotionTarget
  parameters?: Record<string, number>
}

export interface AnimationTarget {
  motion: EmotionMotionTarget
}

export interface LipSyncConfig {
  /** 张嘴幅度参数 ID，不同模型可能不叫 ParamMouthOpenY */
  mouthOpenParam: string
  /** 幅度缩放，1 = 原样，0.6 = 收一点 */
  gain: number
}

export const DEFAULT_LIP_SYNC: LipSyncConfig = {
  mouthOpenParam: 'ParamMouthOpenY',
  gain: 1,
}

export interface ModelEmotionAdapter {
  version: 1
  modelId?: string
  name?: string
  /** 待机动作组，留空则退回按组名猜（idle/neutral/...） */
  idleMotions: string[]
  lipSync: LipSyncConfig
  /** 情绪键 → 表现目标；键不限于内置词表，模型可声明任意自定义情绪 */
  emotions: Record<string, EmotionTarget>
  animations: Record<string, AnimationTarget>
  /** 是否真的读到了 deskpet-adapter.json（没有适配文件的模型不需要校验） */
  loaded: boolean
}

const EMPTY_ADAPTER: ModelEmotionAdapter = {
  version: 1,
  modelId: 'empty',
  idleMotions: [],
  lipSync: { ...DEFAULT_LIP_SYNC },
  emotions: {},
  animations: {},
  loaded: false
}

function getAdapterUrl(modelUrl: string): string {
  const url = new URL(modelUrl, window.location.href)
  return new URL('deskpet-adapter.json', url).toString()
}

function isDeskpetEmotion(value: string): value is DeskpetEmotion {
  return (DESKPET_EMOTIONS as readonly string[]).includes(value)
}

export function isDeskpetEmotionValue(value: unknown): value is DeskpetEmotion {
  return typeof value === 'string' && isDeskpetEmotion(value)
}

function normalizeTarget(target: unknown): EmotionTarget | null {
  if (!target || typeof target !== 'object') return null

  const entry = target as any
  const normalized: EmotionTarget = {}

  if (typeof entry.expression === 'string' && entry.expression) {
    normalized.expression = entry.expression
  }

  if (entry.motion && typeof entry.motion === 'object' && typeof entry.motion.group === 'string') {
    normalized.motion = {
      group: entry.motion.group,
      index: typeof entry.motion.index === 'number' ? entry.motion.index : 0
    }
  }

  if (entry.parameters && typeof entry.parameters === 'object') {
    const parameters: Record<string, number> = {}
    for (const [id, value] of Object.entries(entry.parameters)) {
      if (typeof id === 'string' && typeof value === 'number') {
        parameters[id] = value
      }
    }
    if (Object.keys(parameters).length > 0) {
      normalized.parameters = parameters
    }
  }

  return normalized.expression || normalized.motion || normalized.parameters ? normalized : null
}

function normalizeAnimationTarget(target: unknown): AnimationTarget | null {
  if (!target || typeof target !== 'object') return null

  const entry = target as any
  if (!entry.motion || typeof entry.motion !== 'object' || typeof entry.motion.group !== 'string') return null

  return {
    motion: {
      group: entry.motion.group,
      index: typeof entry.motion.index === 'number' ? entry.motion.index : 0
    }
  }
}

function normalizeLipSync(raw: unknown): LipSyncConfig {
  const entry = raw as any
  if (!entry || typeof entry !== 'object') return { ...DEFAULT_LIP_SYNC }
  const gain = typeof entry.gain === 'number' && entry.gain > 0 ? entry.gain : DEFAULT_LIP_SYNC.gain
  return {
    mouthOpenParam: typeof entry.mouthOpenParam === 'string' && entry.mouthOpenParam
      ? entry.mouthOpenParam
      : DEFAULT_LIP_SYNC.mouthOpenParam,
    gain: Math.min(4, gain),
  }
}

function normalizeIdleMotions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((group): group is string => typeof group === 'string' && group.length > 0)
}

function normalizeAdapter(raw: any): ModelEmotionAdapter {
  const emotions: Record<string, EmotionTarget> = {}
  const animations: Record<string, AnimationTarget> = {}

  if (raw?.emotions && typeof raw.emotions === 'object') {
    for (const [emotion, target] of Object.entries(raw.emotions)) {
      // 不再限内置词表：自定义情绪键原样保留（模型自定义情绪的入口）
      if (!emotion) continue

      const normalized = normalizeTarget(target)
      if (normalized) emotions[emotion] = normalized
    }
  }

  if (raw?.animations && typeof raw.animations === 'object') {
    for (const [animation, target] of Object.entries(raw.animations)) {
      if (!animation) continue

      const normalized = normalizeAnimationTarget(target)
      if (normalized) animations[animation] = normalized
    }
  }

  return {
    version: 1,
    modelId: typeof raw?.modelId === 'string' ? raw.modelId : undefined,
    name: typeof raw?.name === 'string' ? raw.name : undefined,
    idleMotions: normalizeIdleMotions(raw?.idleMotions),
    lipSync: normalizeLipSync(raw?.lipSync),
    emotions,
    animations,
    loaded: true
  }
}

export async function loadEmotionAdapter(modelUrl: string): Promise<ModelEmotionAdapter> {
  const adapterUrl = getAdapterUrl(modelUrl)

  try {
    const resp = await fetch(adapterUrl, { cache: 'no-cache' })
    if (!resp.ok) {
      console.info(`[Deskpet] No emotion adapter found: ${adapterUrl}`)
      return EMPTY_ADAPTER
    }

    // dev server 对不存在的文件会回 index.html（状态码 200），
    // 直接 json() 会抛 SyntaxError，看起来像“适配器坏了”，其实是“没有适配器”
    const text = await resp.text()
    if (!text.trimStart().startsWith('{')) {
      console.info(`[Deskpet] No emotion adapter for this model: ${adapterUrl}`)
      return EMPTY_ADAPTER
    }

    const raw = JSON.parse(text)
    const adapter = normalizeAdapter(raw)
    const emotionKeys = Object.keys(adapter.emotions)
    const animationKeys = Object.keys(adapter.animations)
    console.info(`[Deskpet] Emotion adapter loaded: ${adapter.name || adapter.modelId || adapterUrl}`)
    console.info(`[Deskpet] Adapter emotions: ${emotionKeys.length ? emotionKeys.join(', ') : '(none)'}`)
    console.info(`[Deskpet] Adapter animations: ${animationKeys.length ? animationKeys.join(', ') : '(none)'}`)
    return adapter
  } catch (err) {
    console.warn('[Deskpet] Failed to load emotion adapter:', err)
    return EMPTY_ADAPTER
  }
}

export function getEmotionTarget(
  adapter: ModelEmotionAdapter | null,
  emotion: string
): EmotionTarget | null {
  if (!adapter || !emotion) return null
  return adapter.emotions[emotion] || null
}

export function getAnimationTarget(
  adapter: ModelEmotionAdapter | null,
  animation: string
): AnimationTarget | null {
  if (!adapter || !animation) return null
  return adapter.animations[animation] || null
}

export const DESKPET_EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'surprise',
  'thinking',
  'shy',
  'curious',
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

export interface ModelEmotionAdapter {
  version: 1
  modelId?: string
  name?: string
  emotions: Partial<Record<DeskpetEmotion, EmotionTarget>>
  animations: Record<string, AnimationTarget>
}

const EMPTY_ADAPTER: ModelEmotionAdapter = {
  version: 1,
  modelId: 'empty',
  emotions: {},
  animations: {}
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

function normalizeAdapter(raw: any): ModelEmotionAdapter {
  const emotions: Partial<Record<DeskpetEmotion, EmotionTarget>> = {}
  const animations: Record<string, AnimationTarget> = {}

  if (raw?.emotions && typeof raw.emotions === 'object') {
    for (const [emotion, target] of Object.entries(raw.emotions)) {
      if (!isDeskpetEmotion(emotion)) continue

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
    emotions,
    animations
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

    const raw = await resp.json()
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
  if (!adapter || !isDeskpetEmotion(emotion)) return null
  return adapter.emotions[emotion] || null
}

export function getAnimationTarget(
  adapter: ModelEmotionAdapter | null,
  animation: string
): AnimationTarget | null {
  if (!adapter || !animation) return null
  return adapter.animations[animation] || null
}

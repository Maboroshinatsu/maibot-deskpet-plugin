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
}

export interface ModelEmotionAdapter {
  version: 1
  modelId?: string
  name?: string
  emotions: Partial<Record<DeskpetEmotion, EmotionTarget>>
  animations: Record<string, EmotionTarget>
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

  return normalized.expression || normalized.motion ? normalized : null
}

function normalizeAdapter(raw: any): ModelEmotionAdapter {
  const emotions: Partial<Record<DeskpetEmotion, EmotionTarget>> = {}
  const animations: Record<string, EmotionTarget> = {}

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

      const normalized = normalizeTarget(target)
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
    console.info(`[Deskpet] Emotion adapter loaded: ${adapter.modelId || adapterUrl}`)
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
): EmotionTarget | null {
  if (!adapter || !animation) return null
  return adapter.animations[animation] || null
}

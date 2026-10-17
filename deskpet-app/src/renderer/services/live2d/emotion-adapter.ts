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

import type { ModelCapabilities, ModelDiskAssetsInfo } from './loader'

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

export interface ModelControlTarget {
  /** 控件显示名称，不填则用键名 */
  label?: string
  /** 控件分类（outfit / hair / pose_prop / face_effect / toggle） */
  category?: string
  /** 是否默认开启 */
  defaultActive?: boolean
  /** 关联的 .exp3.json 名称（即使未在 model3.json 注册也可自动解析为参数） */
  expression?: string
  /** 激活该控件时写入的参数映射 */
  parameters?: Record<string, number>
  /** 激活该控件时隐藏的部件 ID 列表 */
  hiddenParts?: string[]
  /** 激活该控件时强制显示的部件 ID 列表（如 pose3.json 中的 PartArmB） */
  shownParts?: string[]
}

export interface ResolvedModelControl {
  id: string
  label: string
  category: string
  parameters: Record<string, number>
  hiddenParts: string[]
  shownParts?: string[]
  defaultActive: boolean
  active: boolean
  source: 'adapter' | 'auto'
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
  /** 底层常驻参数（如去除作者水印、修正默认姿态），不受情绪切换或控件重置影响 */
  baseParameters: Record<string, number>
  /** 底层常驻隐藏的部件 ID 列表 */
  hiddenParts: string[]
  /** 情绪键 → 表现目标；键不限于内置词表，模型可声明任意自定义情绪 */
  emotions: Record<string, EmotionTarget>
  animations: Record<string, AnimationTarget>
  /** 显式声明的模型控件开关（服饰/发型/道具/特效） */
  controls: Record<string, ModelControlTarget>
  /** 是否真的读到了 deskpet-adapter.json（没有适配文件的模型不需要校验） */
  loaded: boolean
}

function createEmptyAdapter(): ModelEmotionAdapter {
  return {
    version: 1,
    modelId: 'empty',
    idleMotions: [],
    lipSync: { ...DEFAULT_LIP_SYNC },
    baseParameters: {},
    hiddenParts: [],
    emotions: {},
    animations: {},
    controls: {},
    loaded: false,
  }
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

function normalizeParametersMap(raw: unknown): Record<string, number> {
  const parameters: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return parameters
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === 'string' && id && typeof value === 'number' && Number.isFinite(value)) {
      parameters[id] = value
    }
  }
  return parameters
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim())
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

  const parameters = normalizeParametersMap(entry.parameters)
  if (Object.keys(parameters).length > 0) {
    normalized.parameters = parameters
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

function normalizeControlTarget(target: unknown): ModelControlTarget | null {
  if (!target || typeof target !== 'object') return null
  const entry = target as any
  const normalized: ModelControlTarget = {}

  if (typeof entry.label === 'string' && entry.label.trim()) {
    normalized.label = entry.label.trim()
  }
  if (typeof entry.category === 'string' && entry.category.trim()) {
    normalized.category = entry.category.trim()
  }
  if (typeof entry.defaultActive === 'boolean') {
    normalized.defaultActive = entry.defaultActive
  }
  if (typeof entry.expression === 'string' && entry.expression.trim()) {
    normalized.expression = entry.expression.trim()
  }
  const parameters = normalizeParametersMap(entry.parameters)
  if (Object.keys(parameters).length > 0) {
    normalized.parameters = parameters
  }
  const hiddenParts = normalizeStringList(entry.hiddenParts)
  if (hiddenParts.length > 0) {
    normalized.hiddenParts = hiddenParts
  }
  const shownParts = normalizeStringList(entry.shownParts)
  if (shownParts.length > 0) {
    normalized.shownParts = shownParts
  }

  return normalized.expression || normalized.parameters || normalized.hiddenParts || normalized.shownParts
    ? normalized
    : null
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
  const controls: Record<string, ModelControlTarget> = {}

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

  if (raw?.controls && typeof raw.controls === 'object') {
    for (const [controlId, target] of Object.entries(raw.controls)) {
      if (!controlId) continue
      const normalized = normalizeControlTarget(target)
      if (normalized) controls[controlId] = normalized
    }
  }

  return {
    version: 1,
    modelId: typeof raw?.modelId === 'string' ? raw.modelId : undefined,
    name: typeof raw?.name === 'string' ? raw.name : undefined,
    idleMotions: normalizeIdleMotions(raw?.idleMotions),
    lipSync: normalizeLipSync(raw?.lipSync),
    baseParameters: normalizeParametersMap(raw?.baseParameters),
    hiddenParts: normalizeStringList(raw?.hiddenParts),
    emotions,
    animations,
    controls,
    loaded: true
  }
}

export async function loadEmotionAdapter(modelUrl: string): Promise<ModelEmotionAdapter> {
  const adapterUrl = getAdapterUrl(modelUrl)

  try {
    const resp = await fetch(adapterUrl, { cache: 'no-cache' })
    if (!resp.ok) {
      console.info(`[Deskpet] No emotion adapter found: ${adapterUrl}`)
      return createEmptyAdapter()
    }

    // dev server 对不存在的文件会回 index.html（状态码 200），
    // 直接 json() 会抛 SyntaxError，看起来像“适配器坏了”，其实是“没有适配器”
    const text = await resp.text()
    if (!text.trimStart().startsWith('{')) {
      console.info(`[Deskpet] No emotion adapter for this model: ${adapterUrl}`)
      return createEmptyAdapter()
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
    return createEmptyAdapter()
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

// ── 自动发现水印与模型控件（结合 .exp3.json / .cdi3.json / .physics3.json / .vtube.json） ──

const STANDARD_PARAM_PREFIXES = [
  'ParamAngle', 'ParamEye', 'ParamBrow', 'ParamMouth', 'ParamBody',
  'ParamBreath', 'ParamCheek', 'ParamHair', 'ParamArm', 'ParamPosition',
  'ParamShoulder', 'ParamStep', 'ParamHand', 'PARAM_', 'Voice', 'Mouth', 'Jaw', 'Cheek',
]

const NOISE_NAME_RE =
  /角度|旋转|呼吸|眼珠|眼球|眨眼|开闭|開閉|微笑|张开|闭合|変形|变形|摇动|物理|\[物\]|唯一发布渠道|哔哩哔哩|账号|立绘[:：]|建模[:：]|^参数\d+$|^Param|Position|Rotation|Shoulder|Step|Hand|Mouth|Jaw|Cheek|舌|目玉|体の回転|照れ|右耳|左耳/i

const WATERMARK_RE = /水印|watermark|shuiyin/i
const SHOW_WATERMARK_RE = /显示水印|打开水印|开启水印|show\s*watermark/i

export function inferControlCategory(id: string, label: string): string {
  const text = `${id} ${label}`
  if (/衣|服|外套|裙|袖|领|帽|鞋|袜|眼镜|耳机|发卡|饰|包|蝴蝶结|uniform|dress|coat|hat|glasses|shirt|skirt|hoodie|tie/i.test(text)) {
    return 'outfit'
  }
  if (/发|马尾|刘海|辫|呆毛|hair|ponytail|bangs|twintail/i.test(text)) {
    return 'hair'
  }
  if (/手|姿|抱|持|拿|捧|挥|麦克风|手柄|棒|刀|剑|斧|剪刀|锤|荧光棒|pose|hand|arm|hold|mic|staff|bat|hammer|scissors|axe|gamepad/i.test(text)) {
    return 'pose_prop'
  }
  if (/眼|瞳|泪|黑化|脸黑|红晕|脸红|汗|嘴|舌|眉|牙|恶魔|翅膀|角|尾|eye|tear|blush|dark|yandere|mouth|brow|wing|horn|tail/i.test(text)) {
    return 'face_effect'
  }
  return 'toggle'
}

export interface ResolvedModelState {
  baseParameters: Record<string, number>
  hiddenParts: string[]
  controls: ResolvedModelControl[]
}

/**
 * 结合 adapter 显式声明与模型磁盘资产（.exp3.json / .cdi3.json / .physics3.json / .vtube.json），
 * 完成三件事：
 *   1. 自动识别去除作者水印的参数与图层，合并进 baseParameters / hiddenParts（常驻底层，永不因情绪切换而恢复）
 *   2. 对 adapter.emotions 中引用了未注册进 .model3.json 的 .exp3.json 表情，自动内联其参数
 *   3. 解析显式声明 + 自动发现的模型控件（服饰、发型、道具、姿势、脸部开关）
 */
export function resolveModelControlsAndBase(
  adapter: ModelEmotionAdapter,
  caps: ModelCapabilities,
  diskAssets?: ModelDiskAssetsInfo | null,
): ResolvedModelState {
  const paramById = new Map(caps.parameters.map((p) => [p.id, p]))
  const registeredExps = new Set(caps.expressions)
  const cdiParams = diskAssets?.cdiParameters ?? {}
  const cdiParts = diskAssets?.cdiParts ?? {}
  const physicsOut = new Set(diskAssets?.physicsOutputIds ?? [])
  const vtubeHotkeys = diskAssets?.vtubeHotkeys ?? {}
  const diskExpressions = diskAssets?.expressions ?? []

  const diskExpByName = new Map<string, { name: string; file: string; parameters: Array<{ id: string; value: number }> }>()
  for (const exp of diskExpressions) {
    diskExpByName.set(exp.name.toLowerCase(), exp)
    diskExpByName.set(exp.file.toLowerCase(), exp)
  }

  const baseParameters: Record<string, number> = {}
  for (const [id, val] of Object.entries(adapter.baseParameters)) {
    if (paramById.has(id)) baseParameters[id] = val
  }

  const baseHiddenPartsSet = new Set<string>(adapter.hiddenParts)
  for (const part of caps.parts ?? []) {
    const partName = (part.name ?? cdiParts[part.id] ?? '').trim()
    // 跳过 .psd 根图层容器（避免整个模型 PSD 文件名带“水印”时误隐藏全身），只隐藏具体水印部件
    if (/\.psd$/i.test(partName)) continue
    if (WATERMARK_RE.test(part.id) || (partName && WATERMARK_RE.test(partName) && !SHOW_WATERMARK_RE.test(partName))) {
      baseHiddenPartsSet.add(part.id)
    }
  }

  const watermarkParamIds = new Set<string>()
  const coveredParams = new Set<string>(Object.keys(baseParameters))

  // 1) 扫描 .exp3.json 中的水印项
  for (const exp of diskExpressions) {
    if (!exp.parameters.length) continue
    const hk = vtubeHotkeys[exp.file] ?? ''
    const allParamNames = exp.parameters.map((p) => cdiParams[p.id]?.name ?? '')
    const combined = [exp.name, hk, ...allParamNames].join(' ')
    if (!WATERMARK_RE.test(combined)) continue

    const isRemoval = !SHOW_WATERMARK_RE.test(combined)

    for (const p of exp.parameters) {
      const pname = cdiParams[p.id]?.name ?? ''
      if (WATERMARK_RE.test(p.id) || WATERMARK_RE.test(pname) || exp.parameters.length === 1) {
        watermarkParamIds.add(p.id)
        coveredParams.add(p.id)
        if (isRemoval && !(p.id in baseParameters) && paramById.has(p.id)) {
          baseParameters[p.id] = p.value
        }
      }
    }
  }

  // 检查 .cdi3.json 里独立的去水印参数（无 .exp3.json 时兜底）
  for (const p of caps.parameters) {
    const pname = p.name ?? cdiParams[p.id]?.name ?? ''
    const combined = `${p.id} ${pname}`
    if (WATERMARK_RE.test(combined)) {
      watermarkParamIds.add(p.id)
      if (!SHOW_WATERMARK_RE.test(combined) && !(p.id in baseParameters) && p.default === 0 && p.max > 0) {
        baseParameters[p.id] = p.max
      }
    }
  }

  // 2) 为 adapter.emotions 中未注册进 .model3.json 的 .exp3.json 自动内联参数，并记录已被情绪占用的表情与单参数
  const emotionExpNames = new Set<string>()
  const emotionSingleParams = new Set<string>()
  for (const [emotion, target] of Object.entries(adapter.emotions)) {
    if (!target) continue
    if (target.expression) {
      if (emotion !== 'neutral' && emotion !== 'idle') {
        emotionExpNames.add(target.expression.toLowerCase())
      }
      if (!registeredExps.has(target.expression)) {
        const diskExp = diskExpByName.get(target.expression.toLowerCase())
        if (diskExp) {
          const inlined: Record<string, number> = { ...(target.parameters ?? {}) }
          for (const p of diskExp.parameters) {
            if (watermarkParamIds.has(p.id) || !paramById.has(p.id)) continue
            if (!(p.id in inlined)) inlined[p.id] = p.value
          }
          if (Object.keys(inlined).length > 0) {
            target.parameters = inlined
          }
          delete target.expression
        }
      }
    }
    if (emotion !== 'neutral' && emotion !== 'idle') {
      const paramKeys = Object.keys(target.parameters ?? {}).filter((k) => !watermarkParamIds.has(k))
      if (paramKeys.length === 1) {
        emotionSingleParams.add(paramKeys[0])
      }
    }
  }

  // 3) 解析显式声明的 adapter.controls
  const controls: ResolvedModelControl[] = []
  const seenControlIds = new Set<string>()

  for (const [controlId, raw] of Object.entries(adapter.controls)) {
    const params: Record<string, number> = {}
    if (raw.expression) {
      const diskExp = diskExpByName.get(raw.expression.toLowerCase())
      if (diskExp) {
        for (const p of diskExp.parameters) {
          if (!watermarkParamIds.has(p.id) && paramById.has(p.id)) {
            params[p.id] = p.value
            coveredParams.add(p.id)
          }
        }
      }
    }
    if (raw.parameters) {
      for (const [pid, val] of Object.entries(raw.parameters)) {
        if (paramById.has(pid)) {
          params[pid] = val
          coveredParams.add(pid)
        }
      }
    }
    const hiddenParts = (raw.hiddenParts ?? []).filter(Boolean)
    const shownParts = (raw.shownParts ?? []).filter(Boolean)
    if (Object.keys(params).length === 0 && hiddenParts.length === 0 && shownParts.length === 0) continue

    const label = raw.label || controlId
    const category = raw.category || inferControlCategory(controlId, label)
    const defaultActive = !!raw.defaultActive
    controls.push({
      id: controlId,
      label,
      category,
      parameters: params,
      hiddenParts,
      ...(shownParts.length > 0 ? { shownParts } : {}),
      defaultActive,
      active: defaultActive,
      source: 'adapter',
    })
    seenControlIds.add(controlId.toLowerCase())
  }

  // 4) 从 .exp3.json 自动发现模型控件
  for (const exp of diskExpressions) {
    if (!exp.parameters.length) continue
    const stem = exp.name
    const hk = vtubeHotkeys[exp.file] ?? ''
    const allParamNames = exp.parameters.map((p) => cdiParams[p.id]?.name ?? '')
    const combined = [stem, hk, ...allParamNames].join(' ')

    // 跳过水印表情与已被非中性情绪直接引用的表情
    if (WATERMARK_RE.test(combined)) continue
    if (emotionExpNames.has(stem.toLowerCase()) || emotionExpNames.has(exp.file.toLowerCase())) {
      for (const p of exp.parameters) coveredParams.add(p.id)
      continue
    }

    const cleanParams: Record<string, number> = {}
    const activeParamNames: string[] = []
    for (const p of exp.parameters) {
      const pname = cdiParams[p.id]?.name ?? ''
      if (watermarkParamIds.has(p.id) || WATERMARK_RE.test(p.id) || WATERMARK_RE.test(pname)) {
        continue
      }
      if (!paramById.has(p.id)) continue
      cleanParams[p.id] = p.value
      coveredParams.add(p.id)
      const defVal = paramById.get(p.id)?.default ?? 0
      if (p.value !== defVal && pname && !NOISE_NAME_RE.test(pname) && !activeParamNames.includes(pname)) {
        activeParamNames.push(pname)
      }
    }

    const cleanKeys = Object.keys(cleanParams)
    if (cleanKeys.length === 0) continue
    if (cleanKeys.length === 1 && emotionSingleParams.has(cleanKeys[0])) continue

    let cid: string
    let label: string
    if (/^\d+$/.test(stem) && activeParamNames.length > 0) {
      cid = activeParamNames[0]
      label = activeParamNames.slice(0, 2).join(' / ')
    } else {
      cid = hk && !/^\d+$/.test(hk) ? hk : stem
      const desc = activeParamNames.slice(0, 3).join(' / ')
      label = desc && desc.toLowerCase() !== cid.toLowerCase() ? `${cid} (${desc})` : cid
    }

    if (seenControlIds.has(cid.toLowerCase())) continue
    seenControlIds.add(cid.toLowerCase())

    controls.push({
      id: cid,
      label,
      category: inferControlCategory(cid, label),
      parameters: cleanParams,
      hiddenParts: [],
      defaultActive: false,
      active: false,
      source: 'auto',
    })
  }

  // 5) 从 .cdi3.json 自动发现独立按键/开关参数（如 wuwuwuwu 的 按键眼镜 / 按键外套）
  for (const p of caps.parameters) {
    if (physicsOut.has(p.id) || coveredParams.has(p.id) || watermarkParamIds.has(p.id)) continue
    if (STANDARD_PARAM_PREFIXES.some((prefix) => p.id.startsWith(prefix))) continue
    const pname = p.name ?? cdiParams[p.id]?.name ?? ''
    const pgroup = p.group ?? cdiParams[p.id]?.group ?? ''
    if (!pname || NOISE_NAME_RE.test(pname)) continue
    if (WATERMARK_RE.test(p.id) || WATERMARK_RE.test(pname)) continue

    if (/按键|开关/.test(pname) || /按键|开关/.test(pgroup)) {
      if (emotionSingleParams.has(p.id)) continue
      if (seenControlIds.has(pname.toLowerCase())) continue
      seenControlIds.add(pname.toLowerCase())
      const targetVal = p.max > 0 ? p.max : 1
      controls.push({
        id: pname,
        label: pname,
        category: inferControlCategory(pname, pname),
        parameters: { [p.id]: targetVal },
        hiddenParts: [],
        defaultActive: false,
        active: false,
        source: 'auto',
      })
    }
  }

  // 6) 从 .pose3.json 或 PartArmA / PartArmB 互斥部件组自动发现手部/姿态切换控件（如 Hiyori 的双手举起 PartArmB）
  const modelPartIds = new Set((caps.parts ?? []).map((pt) => pt.id))
  const diskPoseGroups = diskAssets?.poseGroups ?? caps.poseGroups ?? []
  const hasPoseFile = diskPoseGroups.length > 0
  const effectivePoseGroups: string[][] = []
  for (const grp of diskPoseGroups) {
    const valid = grp.filter((id) => modelPartIds.has(id))
    if (valid.length >= 2) effectivePoseGroups.push(valid)
  }
  if (
    modelPartIds.has('PartArmA') &&
    modelPartIds.has('PartArmB') &&
    !effectivePoseGroups.some((g) => g.includes('PartArmA') && g.includes('PartArmB'))
  ) {
    effectivePoseGroups.push(['PartArmA', 'PartArmB'])
  }

  for (const group of effectivePoseGroups) {
    const altPartIds = group.slice(1)
    for (const altId of altPartIds) {
      // 仅对缺少 .pose3.json 的模型（如 hiyori_vts）默认隐藏备选姿态图层，避免四只手同屏；
      // 有 .pose3.json 的模型由 CubismPose 自动管理，确保 .motion3.json 连续动作能自由切换 PartArmB
      if (!hasPoseFile) {
        baseHiddenPartsSet.add(altId)
      }

      const isArmB = /^PartArmB$/i.test(altId)
      const partName = (cdiParts[altId] ?? '').trim()
      const cid = isArmB ? '双手举起' : partName || altId
      const label = isArmB ? '双手举起 (手臂B)' : partName ? `${partName} (${altId})` : altId
      if (seenControlIds.has(cid.toLowerCase()) || seenControlIds.has(altId.toLowerCase())) continue
      seenControlIds.add(cid.toLowerCase())
      seenControlIds.add(altId.toLowerCase())

      const otherParts = group.filter((id) => id !== altId)
      controls.push({
        id: cid,
        label,
        category: 'pose_prop',
        parameters: {},
        hiddenParts: otherParts,
        shownParts: [altId],
        defaultActive: false,
        active: false,
        source: 'auto',
      })
    }
  }

  return {
    baseParameters,
    hiddenParts: [...baseHiddenPartsSet],
    controls,
  }
}

/** 获取某个控件的"有效激活参数"（非默认值的参数；若全部等于默认值则返回全部）。 */
function getActiveControlParams(
  control: ResolvedModelControl,
  defaultById: Map<string, number>,
): Record<string, number> {
  const nonDefault: Record<string, number> = {}
  for (const [pid, val] of Object.entries(control.parameters)) {
    const def = defaultById.get(pid) ?? 0
    if (val !== def) {
      nonDefault[pid] = val
    }
  }
  return Object.keys(nonDefault).length > 0 ? nonDefault : { ...control.parameters }
}

/** 计算当前所有激活控件合并后的参数层、隐藏部件集合与强制显示部件集合。 */
export function computeControlLayerState(
  controls: ResolvedModelControl[],
  baseHiddenParts: string[],
  caps: ModelCapabilities | null,
): { parameters: Record<string, number>; hiddenParts: string[]; shownParts: string[] } {
  const defaultById = new Map<string, number>(
    (caps?.parameters ?? []).map((p) => [p.id, p.default]),
  )
  const parameters: Record<string, number> = {}
  const hiddenSet = new Set<string>(baseHiddenParts)
  const shownSet = new Set<string>()

  for (const ctrl of controls) {
    if (!ctrl.active) continue
    const activeParams = getActiveControlParams(ctrl, defaultById)
    for (const [pid, val] of Object.entries(activeParams)) {
      parameters[pid] = val
    }
    for (const partId of ctrl.shownParts ?? []) {
      shownSet.add(partId)
      hiddenSet.delete(partId)
    }
    for (const partId of ctrl.hiddenParts) {
      hiddenSet.add(partId)
      shownSet.delete(partId)
    }
  }

  return {
    parameters,
    hiddenParts: [...hiddenSet],
    shownParts: [...shownSet],
  }
}

/** 在控件列表中按 ID 或 label 模糊查找匹配的控件。 */
export function findModelControl(
  controls: ResolvedModelControl[],
  query: string,
): ResolvedModelControl | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  for (const c of controls) {
    if (c.id.toLowerCase() === q || c.label.toLowerCase() === q) return c
  }
  for (const c of controls) {
    const idLower = c.id.toLowerCase()
    const labelLower = c.label.toLowerCase()
    if (idLower.includes(q) || labelLower.includes(q) || q.includes(idLower)) {
      return c
    }
  }
  return null
}

export function isPersistentControlCategory(category: string): boolean {
  return category === 'outfit' || category === 'hair'
}

export interface PresetKeyframeStep {
  label?: string
  durationMs: number
  holdMs: number
  controls: string[]
  parameters: Record<string, number>
}

export type PresetFinishMode = 'hold' | 'revert' | 'loop'

export interface ModelStatePreset {
  id: string
  label: string
  description: string
  emotion: string
  /** 所属情绪/状态分组名称（如 '开心'、'害羞'、'生气不满'、'日常待机' 等，同组可包含多个变体预设供随机抽取） */
  group?: string
  controls: string[]
  /** 预设中包含的面捕/五官/角度连续参数覆盖值（与最后一步同步） */
  parameters?: Record<string, number>
  /** 分步关键帧序列（支持多步连续分镜动画） */
  steps?: PresetKeyframeStep[]
  /** 序列结束后的收尾方式：hold=持续保持终态，revert=演完平滑回退基准态，loop=循环往复 */
  finishMode?: PresetFinishMode
  /** 当 finishMode === 'revert' 时，终态保持多久后回退（默认 1600ms） */
  revertHoldMs?: number
  /** 可选绑定的模型原生 .motion3.json 动作，或 'none' 显式禁用内置动作 */
  motion?: { group: string; index?: number } | 'none'
  custom?: boolean
}

export const PRESET_EMOTION_GROUPS: ReadonlyArray<{ group: string; emotion: string }> = [
  { group: '日常待机', emotion: 'neutral' },
  { group: '开心', emotion: 'happy' },
  { group: '害羞', emotion: 'shy' },
  { group: '委屈难过', emotion: 'sad' },
  { group: '生气不满', emotion: 'angry' },
  { group: '尴尬', emotion: 'embarrassed' },
  { group: '厌烦', emotion: 'neutral' },
  { group: '倦怠', emotion: 'neutral' },
]

export function resolvePresetGroup(preset: {
  id?: string
  label?: string
  emotion?: string
  group?: string
}): string {
  const explicit = (preset.group ?? '').trim()
  if (explicit) return explicit
  const id = (preset.id ?? '').trim().toLowerCase()
  const label = (preset.label ?? '').trim()
  const emo = (preset.emotion ?? '').trim().toLowerCase()
  const prefix = label.split(/[·・\-_/]/)[0]?.trim() ?? ''

  if (id === 'neutral' || id === 'idle' || label === '日常待机') return '日常待机'
  if (id.startsWith('annoyed') || prefix === '厌烦' || /厌烦|嫌弃|白眼/.test(label)) return '厌烦'
  if (id.startsWith('weary') || prefix === '倦怠' || /倦怠|打盹|困倦/.test(label)) return '倦怠'
  if (emo === 'happy' || id.startsWith('happy') || prefix === '开心') return '开心'
  if (emo === 'shy' || id.startsWith('shy') || prefix === '害羞') return '害羞'
  if (emo === 'sad' || id.startsWith('sad') || prefix === '委屈' || prefix === '委屈难过') return '委屈难过'
  if (emo === 'angry' || id.startsWith('angry') || prefix === '生气' || prefix === '生气不满') return '生气不满'
  if (emo === 'embarrassed' || id.startsWith('embarrassed') || prefix === '尴尬') return '尴尬'
  if (prefix && label.includes('·')) return prefix
  if (emo && emo !== 'neutral') return emo
  return '日常待机'
}

export function getPresetDefaultFinishMode(preset: {
  id?: string
  label?: string
  emotion?: string
  group?: string
  finishMode?: PresetFinishMode
}): PresetFinishMode {
  if (
    preset.finishMode === 'hold' ||
    preset.finishMode === 'revert' ||
    preset.finishMode === 'loop'
  ) {
    return preset.finishMode
  }
  const text = `${preset.id ?? ''} ${preset.label ?? ''} ${preset.emotion ?? ''} ${preset.group ?? ''}`
  if (
    /^(neutral|idle|annoyed|weary)/i.test(preset.id ?? '') ||
    /待机|日常|厌烦|倦怠|犯困|造型|服装/i.test(text)
  ) {
    return 'hold'
  }
  return 'revert'
}

export function normalizePresetSteps(preset: {
  controls?: string[]
  parameters?: Record<string, number>
  steps?: PresetKeyframeStep[]
}): PresetKeyframeStep[] {
  if (Array.isArray(preset.steps) && preset.steps.length > 0) {
    return preset.steps.map((s) => ({
      ...(s.label ? { label: s.label } : {}),
      durationMs: Number.isFinite(s.durationMs)
        ? Math.max(40, Math.min(5000, Math.round(s.durationMs)))
        : 350,
      holdMs: Number.isFinite(s.holdMs)
        ? Math.max(0, Math.min(10000, Math.round(s.holdMs)))
        : 150,
      controls: Array.isArray(s.controls) ? [...s.controls] : [...(preset.controls ?? [])],
      parameters: s.parameters ? { ...s.parameters } : {},
    }))
  }
  return [
    {
      durationMs: 380,
      holdMs: 0,
      controls: [...(preset.controls ?? [])],
      parameters: preset.parameters ? { ...preset.parameters } : {},
    },
  ]
}

export interface ResolvedModelSlider {
  id: string
  label: string
  group: 'face' | 'pose' | 'extra'
  min: number
  max: number
  step: number
  defaultValue: number
  value: number
}

const STANDARD_SLIDER_META: Array<{
  re: RegExp
  label: string
  group: 'face' | 'pose'
  order: number
}> = [
  { re: /^ParamEyeLOpen$/i, label: '左眼开合', group: 'face', order: 1 },
  { re: /^ParamEyeROpen$/i, label: '右眼开合', group: 'face', order: 2 },
  { re: /^ParamEyeLSmile$/i, label: '左眼笑意', group: 'face', order: 3 },
  { re: /^ParamEyeRSmile$/i, label: '右眼笑意', group: 'face', order: 4 },
  { re: /^ParamEyeBallX$/i, label: '视线左右', group: 'face', order: 5 },
  { re: /^ParamEyeBallY$/i, label: '视线上下', group: 'face', order: 6 },
  { re: /^ParamBrowLY$/i, label: '左眉高低', group: 'face', order: 7 },
  { re: /^ParamBrowRY$/i, label: '右眉高低', group: 'face', order: 8 },
  { re: /^ParamBrowLX$/i, label: '左眉左右', group: 'face', order: 9 },
  { re: /^ParamBrowRX$/i, label: '右眉左右', group: 'face', order: 10 },
  { re: /^ParamBrowLAngle$/i, label: '左眉角度', group: 'face', order: 11 },
  { re: /^ParamBrowRAngle$/i, label: '右眉角度', group: 'face', order: 12 },
  { re: /^ParamBrowLForm$/i, label: '左眉弯曲', group: 'face', order: 13 },
  { re: /^ParamBrowRForm$/i, label: '右眉弯曲', group: 'face', order: 14 },
  { re: /^ParamMouthForm$/i, label: '嘴角弧度', group: 'face', order: 15 },
  { re: /^ParamMouthOpenY$/i, label: '嘴巴张合', group: 'face', order: 16 },
  { re: /^(Param)?MouthX$/i, label: '歪嘴左右', group: 'face', order: 17 },
  { re: /^(Param)?MouthPucker/i, label: '嘟嘴幅度', group: 'face', order: 18 },
  { re: /^ParamCheek$/i, label: '脸颊红晕', group: 'face', order: 19 },
  { re: /^ParamAngleX$/i, label: '头部左右 (X)', group: 'pose', order: 20 },
  { re: /^ParamAngleY$/i, label: '头部俯仰 (Y)', group: 'pose', order: 21 },
  { re: /^ParamAngleZ$/i, label: '头部歪斜 (Z)', group: 'pose', order: 22 },
  { re: /^ParamBodyAngleX$/i, label: '身体左右 (X)', group: 'pose', order: 23 },
  { re: /^ParamBodyAngleY$/i, label: '身体俯仰 (Y)', group: 'pose', order: 24 },
  { re: /^ParamBodyAngleZ$/i, label: '身体歪斜 (Z)', group: 'pose', order: 25 },
  { re: /^ParamShoulder$/i, label: '双肩耸动', group: 'pose', order: 26 },
  { re: /^ParamLeg$/i, label: '腿部微动', group: 'pose', order: 27 },
  { re: /^ParamStep$/i, label: '步伐微动', group: 'pose', order: 28 },
  { re: /^ParamArmLA$/i, label: '左臂张合 (垂手A)', group: 'pose', order: 30 },
  { re: /^ParamArmRA$/i, label: '右臂张合 (垂手A)', group: 'pose', order: 31 },
  { re: /^ParamHandL$/i, label: '左手手型 (垂手A)', group: 'pose', order: 32 },
  { re: /^ParamHandR$/i, label: '右手手型 (垂手A)', group: 'pose', order: 33 },
  { re: /^ParamArmLB$/i, label: '左臂高低 (举手B)', group: 'pose', order: 34 },
  { re: /^ParamArmRB$/i, label: '右臂高低 (举手B)', group: 'pose', order: 35 },
  { re: /^ParamHandLB$/i, label: '左手旋转 (举手B)', group: 'pose', order: 36 },
  { re: /^ParamHandRB$/i, label: '右手旋转 (举手B)', group: 'pose', order: 37 },
]

function computeSliderStep(min: number, max: number): number {
  const span = Math.abs(max - min)
  if (span <= 2.5) return 0.05
  if (span <= 10) return 0.1
  return 1
}

/**
 * 从当前模型参数清单中提取可供用户调节的 VTB 面捕/五官/姿态滑块。
 * 自动过滤掉底层去水印参数、纯物理输出参数以及已被做成二元开关的单参数控件。
 */
export function resolveModelSliders(
  caps: ModelCapabilities | null,
  controls: ResolvedModelControl[],
  baseParameters: Record<string, number> = {},
): ResolvedModelSlider[] {
  const params = caps?.parameters ?? []
  if (params.length === 0) return []

  const baseIds = new Set(Object.keys(baseParameters))
  const singleToggleParamIds = new Set<string>()
  for (const ctrl of controls) {
    const keys = Object.keys(ctrl.parameters)
    if (keys.length === 1) {
      singleToggleParamIds.add(keys[0])
    }
  }

  const ordered: Array<{ slider: ResolvedModelSlider; order: number }> = []

  for (const p of params) {
    if (baseIds.has(p.id)) continue
    if (p.isPhysicsOutput) continue
    if (/^ParamBreath$/i.test(p.id)) continue
    const span = p.max - p.min
    if (!(span > 0)) continue

    const std = STANDARD_SLIDER_META.find((m) => m.re.test(p.id))
    if (std) {
      ordered.push({
        order: std.order,
        slider: {
          id: p.id,
          label: p.name ? `${std.label}` : std.label,
          group: std.group,
          min: p.min,
          max: p.max,
          step: computeSliderStep(p.min, p.max),
          defaultValue: p.default,
          value: p.default,
        },
      })
      continue
    }

    // 已被识别为独立二元开关的参数不再重复放入滑块
    if (singleToggleParamIds.has(p.id)) continue

    const text = `${p.id} ${p.name ?? ''} ${p.group ?? ''}`
    if (/物理|飘动|摇晃|呼吸|physics|hair.*shake|skirt/i.test(text)) continue

    let group: 'face' | 'pose' | 'extra' = 'extra'
    let order = 100
    if (/眼|眉|嘴|口|舌|腮|脸|瞳|eye|brow|mouth|cheek|pupil|tongue/i.test(text)) {
      group = 'face'
      order = 40
    } else if (/头|身|腰|脖|手|臂|九轴|angle|body|head|arm/i.test(text)) {
      group = 'pose'
      order = 60
    }

    ordered.push({
      order,
      slider: {
        id: p.id,
        label: (p.name || p.id).trim(),
        group,
        min: p.min,
        max: p.max,
        step: computeSliderStep(p.min, p.max),
        defaultValue: p.default,
        value: p.default,
      },
    })
  }

  ordered.sort((a, b) => a.order - b.order)
  return ordered.map((item) => item.slider)
}

/** 记录每个情绪分组上一次随机抽中的预设 ID，同组 >= 2 个预设时避免连续两次抽到同一个变体 */
const lastPickedPresetByGroup = new Map<string, string>()

function chooseNonRepeatingRandomPreset(
  groupKey: string,
  candidates: ModelStatePreset[],
): ModelStatePreset | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const lastId = lastPickedPresetByGroup.get(groupKey)
  const pool = lastId ? candidates.filter((p) => p.id !== lastId) : candidates
  const effectivePool = pool.length > 0 ? pool : candidates
  const picked = effectivePool[Math.floor(Math.random() * effectivePool.length)]
  lastPickedPresetByGroup.set(groupKey, picked.id)
  return picked
}

/**
 * 在指定的情绪分组或情绪键下随机抽取一个预设（同组 >= 2 个预设时防连重）。
 */
export function pickRandomPresetInGroup(
  presets: ModelStatePreset[],
  groupOrEmotion: string,
): ModelStatePreset | null {
  const q = groupOrEmotion.trim().toLowerCase()
  if (!q) return null
  const groupMatches = presets.filter((p) => {
    const grp = resolvePresetGroup(p).toLowerCase()
    const emo = (p.emotion ?? '').trim().toLowerCase()
    return grp === q || (q !== 'neutral' && emo === q)
  })
  return chooseNonRepeatingRandomPreset(q, groupMatches)
}

export function findModelStatePreset(
  presets: ModelStatePreset[],
  query: string,
  options?: { exactOnly?: boolean },
): ModelStatePreset | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  if (options?.exactOnly) {
    for (const p of presets) {
      if (p.id.toLowerCase() === q || p.label.toLowerCase() === q) return p
    }
    return null
  }

  // 1) 若查询词命中某个拥有多个预设变体的「情绪分组名」或「基础情绪名」（例如 'happy' / '开心' / '害羞'），
  //    优先在该分组内随机抽取一个预设变体（防连续重复），丰富状态表现多样性
  const groupMatches = presets.filter((p) => {
    const grp = resolvePresetGroup(p).toLowerCase()
    const emo = (p.emotion ?? '').trim().toLowerCase()
    return grp === q || (q !== 'neutral' && emo === q)
  })
  if (groupMatches.length > 1) {
    return chooseNonRepeatingRandomPreset(q, groupMatches)
  }

  // 2) 精确匹配单个预设的 id 或 label（如具体变体名 '开心·歪头笑'）
  for (const p of presets) {
    if (p.id.toLowerCase() === q || p.label.toLowerCase() === q) return p
  }

  // 3) 若单预设分组命中，直接返回
  if (groupMatches.length === 1) {
    return groupMatches[0]
  }

  // 4) 模糊包含匹配（支持分组名、预设名或 ID 子串匹配；若命中多个同组变体同样随机抽取）
  const fuzzyMatches = presets.filter((p) => {
    const idLower = p.id.toLowerCase()
    const labelLower = p.label.toLowerCase()
    const grpLower = resolvePresetGroup(p).toLowerCase()
    return (
      labelLower.includes(q) ||
      q.includes(labelLower) ||
      grpLower.includes(q) ||
      q.includes(grpLower) ||
      idLower === q
    )
  })
  if (fuzzyMatches.length > 0) {
    return chooseNonRepeatingRandomPreset(q, fuzzyMatches)
  }

  return null
}

/**
 * 对控件列表执行 on / off / toggle / reset / reset_transient / set，并自动处理互斥预设控件
 */
export function applyControlActionToList(
  controls: ResolvedModelControl[],
  query: string | string[],
  action: 'on' | 'off' | 'toggle' | 'reset' | 'reset_transient' | 'set',
  caps: ModelCapabilities | null,
): { matched: ResolvedModelControl | null; matchedList: ResolvedModelControl[]; changed: boolean } {
  if (action === 'reset') {
    let changed = false
    for (const c of controls) {
      if (c.active !== c.defaultActive) {
        c.active = c.defaultActive
        changed = true
      }
    }
    return { matched: null, matchedList: [], changed }
  }

  if (action === 'reset_transient') {
    let changed = false
    for (const c of controls) {
      if (!isPersistentControlCategory(c.category) && c.active !== c.defaultActive) {
        c.active = c.defaultActive
        changed = true
      }
    }
    return { matched: null, matchedList: [], changed }
  }

  const queries = Array.isArray(query)
    ? query.map((s) => String(s).trim()).filter(Boolean)
    : String(query || '')
        .split(/[,，;；]+/)
        .map((s) => s.trim())
        .filter(Boolean)

  let changed = false
  if (action === 'set') {
    for (const c of controls) {
      if (!isPersistentControlCategory(c.category) && c.active !== c.defaultActive) {
        c.active = c.defaultActive
        changed = true
      }
    }
    if (queries.length === 0) {
      return { matched: null, matchedList: [], changed }
    }
  }

  if (queries.length === 0) {
    return { matched: null, matchedList: [], changed: false }
  }

  const defaultById = new Map<string, number>(
    (caps?.parameters ?? []).map((p) => [p.id, p.default]),
  )
  const matchedList: ResolvedModelControl[] = []

  for (const q of queries) {
    const target = findModelControl(controls, q)
    if (!target) continue
    if (!matchedList.includes(target)) matchedList.push(target)

    const effectiveAction = action === 'set' ? 'on' : action
    const nextActive =
      effectiveAction === 'on' ? true : effectiveAction === 'off' ? false : !target.active
    if (target.active !== nextActive) {
      changed = true
    }
    target.active = nextActive

    if (nextActive) {
      const targetTouchedIds = new Set(Object.keys(target.parameters))
      const targetHiddenSet = new Set(target.hiddenParts)
      const targetShownSet = new Set(target.shownParts ?? [])
      for (const other of controls) {
        if (other === target || !other.active) continue
        const otherActiveIds = Object.keys(getActiveControlParams(other, defaultById))
        const paramConflict =
          otherActiveIds.length > 0 && otherActiveIds.every((id) => targetTouchedIds.has(id))
        const poseConflict =
          (other.shownParts ?? []).some((p) => targetHiddenSet.has(p)) ||
          other.hiddenParts.some((p) => targetShownSet.has(p))
        if (paramConflict || poseConflict) {
          other.active = false
          changed = true
        }
      }
    }
  }

  return {
    matched: matchedList[0] ?? null,
    matchedList,
    changed: matchedList.length > 0 || changed,
  }
}

/**
 * 根据预设的 ID、名称或情绪键，解析切换该预设时应同步播放的连续动作（.motion3.json）。
 * 优先使用 deskpet-adapter.json 中的动作映射，若无适配文件则自动回退匹配模型自带的动作组。
 */
export function resolvePresetMotion(
  preset: {
    id?: string
    label?: string
    emotion?: string
    controls?: string[]
    motion?: { group: string; index?: number } | 'none'
  },
  adapter: ModelEmotionAdapter | null,
  caps: ModelCapabilities | null,
): EmotionMotionTarget | null {
  if (preset.motion === 'none') return null
  const motionGroups = caps?.motionGroups ?? {}
  const hasGroup = (g: string) => (motionGroups[g] ?? 0) > 0
  if (preset.motion && typeof preset.motion === 'object' && preset.motion.group) {
    if (hasGroup(preset.motion.group)) {
      return { group: preset.motion.group, index: preset.motion.index ?? 0 }
    }
  }

  if (preset.id && preset.id !== 'neutral' && preset.id !== 'idle') {
    const byId = getEmotionTarget(adapter, preset.id)?.motion
    if (byId && hasGroup(byId.group)) return byId
    const animById = getAnimationTarget(adapter, preset.id)?.motion
    if (animById && hasGroup(animById.group)) return animById
  }

  if (preset.emotion && preset.emotion !== 'neutral' && preset.emotion !== 'idle') {
    const byEmo = getEmotionTarget(adapter, preset.emotion)?.motion
    if (byEmo && hasGroup(byEmo.group)) return byEmo
  }

  const text = `${preset.id ?? ''} ${preset.label ?? ''} ${preset.emotion ?? ''} ${(preset.controls ?? []).join(' ')}`
  if (/双手举起|思考|好奇|thinking|curious|wake/i.test(text)) {
    const t = getEmotionTarget(adapter, 'thinking')?.motion ?? getEmotionTarget(adapter, 'curious')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('FlickUp')) return { group: 'FlickUp', index: 0 }
  }
  if (/开心|欢呼|挥手|高兴|愉快|happy|cheer|wave|smile/i.test(text)) {
    const t = getEmotionTarget(adapter, 'happy')?.motion ?? getAnimationTarget(adapter, 'cheer')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('Tap')) return { group: 'Tap', index: (motionGroups.Tap ?? 1) > 1 ? 1 : 0 }
  }
  if (/生气|不满|愤怒|厌烦|嫌弃|烦躁|angry|annoyed/i.test(text)) {
    const t = getEmotionTarget(adapter, 'angry')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('Flick@Body')) return { group: 'Flick@Body', index: 0 }
  }
  if (/委屈|难过|伤心|哭|倦怠|困倦|疲惫|sad|weary|sleep/i.test(text)) {
    const t = getEmotionTarget(adapter, 'sad')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('FlickDown')) return { group: 'FlickDown', index: 0 }
  }
  if (/害羞|羞怯|尴尬|脸红|shy|embarrassed/i.test(text)) {
    const t = getEmotionTarget(adapter, 'shy')?.motion ?? getEmotionTarget(adapter, 'embarrassed')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('Tap@Body')) return { group: 'Tap@Body', index: 0 }
  }
  if (/惊讶|吃惊|吓|surprise/i.test(text)) {
    const t = getEmotionTarget(adapter, 'surprise')?.motion
    if (t && hasGroup(t.group)) return t
    if (hasGroup('Flick')) return { group: 'Flick', index: 0 }
  }
  return null
}

/**
 * 为新模型生成初始可编辑、可删除的「状态/情绪组合预设」种子列表。
 * 包含常规神态与非常规神态（厌烦、倦怠、尴尬等），并内置多步连续分镜序列与收尾模式。
 */
export function buildModelStatePresets(
  controls: ResolvedModelControl[],
  _modelEmotions: string[],
  sliders: ResolvedModelSlider[] = [],
): ModelStatePreset[] {
  const defaultActiveIds = controls.filter((c) => c.defaultActive).map((c) => c.id)

  const sliderMap = new Map<string, ResolvedModelSlider>()
  for (const s of sliders) {
    sliderMap.set(s.id.toLowerCase(), s)
  }

  const pickParam = (id: string, ratio: 'min' | 'max' | number): Record<string, number> => {
    const s = sliderMap.get(id.toLowerCase())
    if (!s) return {}
    let val = s.defaultValue
    if (ratio === 'max') val = s.max
    else if (ratio === 'min') val = s.min
    else if (ratio >= 0) val = s.defaultValue + (s.max - s.defaultValue) * ratio
    else val = s.defaultValue + (s.defaultValue - s.min) * ratio
    const rounded = Math.round(val * 100) / 100
    if (Math.abs(rounded - s.defaultValue) < 1e-3) return {}
    return { [s.id]: rounded }
  }

  const pickAbsoluteEye = (openVal: number): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
      const s = sliderMap.get(id.toLowerCase())
      if (s) {
        const clamped = Math.max(s.min, Math.min(s.max, openVal))
        out[s.id] = Math.round(clamped * 100) / 100
      }
    }
    return out
  }

  const pickControls = (re: RegExp, maxCount = 1): ResolvedModelControl[] => {
    const picked: ResolvedModelControl[] = []
    for (const c of controls) {
      if (c.category !== 'face_effect' && c.category !== 'toggle') continue
      if (re.test(c.id + ' ' + c.label)) {
        picked.push(c)
        if (picked.length >= maxCount) break
      }
    }
    return picked
  }

  const presets: ModelStatePreset[] = [
    {
      id: 'neutral',
      label: '日常待机',
      description: '默认外观与自然面捕状态',
      emotion: 'neutral',
      group: '日常待机',
      controls: [...defaultActiveIds],
      parameters: {},
      steps: [
        {
          label: '自然待机',
          durationMs: 800,
          holdMs: 0,
          controls: [...defaultActiveIds],
          parameters: {},
        },
      ],
      finishMode: 'hold',
      custom: true,
    },
  ]

  const specs: Array<{
    id: string
    label: string
    group: string
    emotion: string
    fallbackDesc: string
    re: RegExp
    finishMode: PresetFinishMode
    revertHoldMs?: number
    stepDefs: Array<{
      label: string
      durationMs: number
      holdMs: number
      params: Record<string, number>
    }>
  }> = [
    {
      id: 'happy',
      label: '开心·欢呼',
      group: '开心',
      emotion: 'happy',
      fallbackDesc: '欢呼微晃 · 明眸甜笑与愉悦神态',
      re: /星星|闪亮|爱心|心眼|笑|开心|比耶|star|heart|happy|smile|peace/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '欢呼侧倾',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(1.0),
            ...pickParam('ParamMouthForm', 0.8),
            ...pickParam('ParamMouthOpenY', 0.2),
            ...pickParam('ParamEyeLSmile', 0.8),
            ...pickParam('ParamEyeRSmile', 0.8),
            ...pickParam('ParamAngleZ', 0.14),
            ...pickParam('ParamBodyAngleZ', 0.08),
            ...pickParam('ParamAngleY', 0.1),
            ...pickParam('ParamEyeBallY', 0.1),
            ...pickParam('ParamCheek', 0.45),
          },
        },
        {
          label: '愉悦展颜',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(1.0),
            ...pickParam('ParamMouthForm', 0.85),
            ...pickParam('ParamMouthOpenY', 0.25),
            ...pickParam('ParamEyeLSmile', 0.85),
            ...pickParam('ParamEyeRSmile', 0.85),
            ...pickParam('ParamCheek', 0.55),
            ...pickParam('ParamAngleY', 0.06),
            ...pickParam('ParamEyeBallY', 0.08),
          },
        },
      ],
    },
    {
      id: 'happy_tilt',
      label: '开心·歪头笑',
      group: '开心',
      emotion: 'happy',
      fallbackDesc: '俏皮歪头 · 明朗甜笑',
      re: /笑|开心|比耶|脸红|smile|happy|peace|blush/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '轻仰展颜',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(1.0),
            ...pickParam('ParamMouthForm', 0.8),
            ...pickParam('ParamMouthOpenY', 0.2),
            ...pickParam('ParamEyeLSmile', 0.8),
            ...pickParam('ParamEyeRSmile', 0.8),
            ...pickParam('ParamAngleY', 0.12),
            ...pickParam('ParamEyeBallY', 0.1),
          },
        },
        {
          label: '俏皮歪头',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(1.0),
            ...pickParam('ParamMouthForm', 0.85),
            ...pickParam('ParamEyeLSmile', 0.85),
            ...pickParam('ParamEyeRSmile', 0.85),
            ...pickParam('ParamCheek', 0.5),
            ...pickParam('ParamAngleZ', 0.18),
            ...pickParam('ParamBodyAngleZ', 0.08),
            ...pickParam('ParamEyeBallX', 0.12),
            ...pickParam('ParamEyeBallY', 0.08),
          },
        },
      ],
    },
    {
      id: 'sad',
      label: '委屈·欲言又止',
      group: '委屈难过',
      emotion: 'sad',
      fallbackDesc: '低头蹙眉 · 八字眉委屈欲泣',
      re: /泪|哭|委屈|悲|tear|cry|sad/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '欲言又止',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.7),
            ...pickParam('ParamBrowLY', -0.25),
            ...pickParam('ParamBrowRY', -0.25),
            ...pickParam('ParamBrowLAngle', 0.3),
            ...pickParam('ParamBrowRAngle', 0.3),
            ...pickParam('ParamBrowLForm', 0.35),
            ...pickParam('ParamBrowRForm', 0.35),
            ...pickParam('ParamMouthForm', -0.35),
          },
        },
        {
          label: '垂眸低落',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.6),
            ...pickParam('ParamMouthForm', -0.55),
            ...pickParam('ParamBrowLY', -0.35),
            ...pickParam('ParamBrowRY', -0.35),
            ...pickParam('ParamBrowLAngle', 0.35),
            ...pickParam('ParamBrowRAngle', 0.35),
            ...pickParam('ParamBrowLForm', 0.45),
            ...pickParam('ParamBrowRForm', 0.45),
            ...pickParam('ParamAngleY', -0.22),
            ...pickParam('ParamBodyAngleY', -0.08),
            ...pickParam('ParamAngleZ', -0.08),
            ...pickParam('ParamEyeBallY', -0.25),
          },
        },
      ],
    },
    {
      id: 'sad_glance',
      label: '委屈·撇嘴侧目',
      group: '委屈难过',
      emotion: 'sad',
      fallbackDesc: '侧目轻叹 · 八字眉委屈撇嘴',
      re: /泪|委屈|悲|汗|tear|sad/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '委屈蹙眉',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.65),
            ...pickParam('ParamBrowLY', -0.3),
            ...pickParam('ParamBrowRY', -0.3),
            ...pickParam('ParamBrowLAngle', 0.35),
            ...pickParam('ParamBrowRAngle', 0.35),
            ...pickParam('ParamBrowLForm', 0.35),
            ...pickParam('ParamBrowRForm', 0.35),
            ...pickParam('ParamMouthForm', -0.45),
          },
        },
        {
          label: '侧目轻叹',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.6),
            ...pickParam('ParamBrowLY', -0.35),
            ...pickParam('ParamBrowRY', -0.35),
            ...pickParam('ParamBrowLAngle', 0.35),
            ...pickParam('ParamBrowRAngle', 0.35),
            ...pickParam('ParamBrowLForm', 0.4),
            ...pickParam('ParamBrowRForm', 0.4),
            ...pickParam('ParamMouthForm', -0.6),
            ...pickParam('ParamAngleX', -0.18),
            ...pickParam('ParamBodyAngleX', -0.08),
            ...pickParam('ParamAngleY', -0.15),
            ...pickParam('ParamEyeBallX', -0.25),
            ...pickParam('ParamEyeBallY', -0.2),
          },
        },
      ],
    },
    {
      id: 'angry',
      label: '生气·扭头哼气',
      group: '生气不满',
      emotion: 'angry',
      fallbackDesc: '扭头哼气 · 压眉傲娇怒视',
      re: /生气|怒|黑化|脸黑|阴影|angry|anger|dark/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '扭头哼气',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.85),
            ...pickParam('ParamEyeBallX', -0.25),
            ...pickParam('ParamMouthForm', -0.65),
            ...pickParam('ParamBrowLY', -0.45),
            ...pickParam('ParamBrowRY', -0.45),
            ...pickParam('ParamBrowLAngle', -0.45),
            ...pickParam('ParamBrowRAngle', -0.45),
            ...pickParam('ParamBrowLForm', -0.4),
            ...pickParam('ParamBrowRForm', -0.4),
            ...pickParam('ParamAngleX', -0.26),
            ...pickParam('ParamBodyAngleX', -0.1),
            ...pickParam('ParamAngleZ', -0.12),
          },
        },
        {
          label: '回正瞪眼',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.9),
            ...pickParam('ParamMouthForm', -0.7),
            ...pickParam('ParamBrowLY', -0.5),
            ...pickParam('ParamBrowRY', -0.5),
            ...pickParam('ParamBrowLAngle', -0.5),
            ...pickParam('ParamBrowRAngle', -0.5),
            ...pickParam('ParamBrowLForm', -0.45),
            ...pickParam('ParamBrowRForm', -0.45),
            ...pickParam('ParamAngleY', -0.1),
          },
        },
      ],
    },
    {
      id: 'angry_glare',
      label: '生气·压眉紧盯',
      group: '生气不满',
      emotion: 'angry',
      fallbackDesc: '歪头紧盯 · 压眉赌气不满',
      re: /生气|怒|angry|anger/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '压眉俯视',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.85),
            ...pickParam('ParamBrowLY', -0.5),
            ...pickParam('ParamBrowRY', -0.5),
            ...pickParam('ParamBrowLAngle', -0.5),
            ...pickParam('ParamBrowRAngle', -0.5),
            ...pickParam('ParamBrowLForm', -0.4),
            ...pickParam('ParamBrowRForm', -0.4),
            ...pickParam('ParamMouthForm', -0.6),
            ...pickParam('ParamAngleY', -0.18),
          },
        },
        {
          label: '歪头赌气',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.85),
            ...pickParam('ParamBrowLY', -0.5),
            ...pickParam('ParamBrowRY', -0.5),
            ...pickParam('ParamBrowLAngle', -0.5),
            ...pickParam('ParamBrowRAngle', -0.5),
            ...pickParam('ParamBrowLForm', -0.4),
            ...pickParam('ParamBrowRForm', -0.4),
            ...pickParam('ParamMouthForm', -0.75),
            ...pickParam('ParamAngleZ', 0.18),
            ...pickParam('ParamBodyAngleZ', 0.08),
            ...pickParam('ParamAngleY', -0.12),
          },
        },
      ],
    },
    {
      id: 'annoyed',
      label: '厌烦·轻哼斜视',
      group: '厌烦',
      emotion: 'neutral',
      fallbackDesc: '轻哼斜视 · 半眯眼冷淡嫌弃',
      re: /黑脸|脸黑|阴影|无语|汗|dark|shadow/i,
      finishMode: 'hold',
      stepDefs: [
        {
          label: '轻哼别过',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.65),
            ...pickParam('ParamEyeBallX', 0.22),
            ...pickParam('ParamEyeBallY', 0.12),
            ...pickParam('ParamMouthForm', -0.35),
            ...pickParam('ParamAngleY', 0.12),
          },
        },
        {
          label: '斜视嫌弃',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.6),
            ...pickParam('ParamEyeBallX', 0.28),
            ...pickParam('ParamEyeBallY', 0.08),
            ...pickParam('ParamMouthForm', -0.45),
            ...pickParam('ParamBrowLAngle', -0.3),
            ...pickParam('ParamBrowRAngle', -0.3),
            ...pickParam('ParamBrowLForm', -0.25),
            ...pickParam('ParamBrowRForm', -0.25),
            ...pickParam('ParamAngleZ', -0.16),
            ...pickParam('ParamBodyAngleZ', -0.07),
          },
        },
      ],
    },
    {
      id: 'weary',
      label: '倦怠·打盹',
      group: '倦怠',
      emotion: 'neutral',
      fallbackDesc: '打盹低头 · 困倦半闭眼放松',
      re: /困|睡|疲|sleep|tired/i,
      finishMode: 'hold',
      stepDefs: [
        {
          label: '打盹低头',
          durationMs: 900,
          holdMs: 1200,
          params: {
            ...pickAbsoluteEye(0.22),
            ...pickParam('ParamBrowLY', -0.25),
            ...pickParam('ParamBrowRY', -0.25),
            ...pickParam('ParamAngleY', -0.28),
            ...pickParam('ParamBodyAngleY', -0.1),
            ...pickParam('ParamAngleZ', 0.1),
          },
        },
        {
          label: '困倦半睁',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.42),
            ...pickParam('ParamBrowLY', -0.2),
            ...pickParam('ParamBrowRY', -0.2),
            ...pickParam('ParamMouthForm', -0.15),
            ...pickParam('ParamAngleY', -0.2),
            ...pickParam('ParamAngleZ', 0.12),
          },
        },
      ],
    },
    {
      id: 'embarrassed',
      label: '尴尬·视线躲闪',
      group: '尴尬',
      emotion: 'embarrassed',
      fallbackDesc: '左右顾盼 · 视线躲闪与微红干笑',
      re: /汗|尴尬|脸红|捂脸|sweat|blush/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '往左张望',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickParam('ParamEyeBallX', -0.28),
            ...pickParam('ParamEyeBallY', -0.12),
            ...pickParam('ParamAngleX', -0.12),
            ...pickParam('ParamBrowLY', -0.15),
            ...pickParam('ParamBrowRY', 0.12),
          },
        },
        {
          label: '往右张望',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickParam('ParamEyeBallX', 0.26),
            ...pickParam('ParamEyeBallY', -0.08),
            ...pickParam('ParamAngleX', 0.12),
            ...pickParam('ParamBrowLY', 0.12),
            ...pickParam('ParamBrowRY', -0.15),
          },
        },
        {
          label: '移开视线',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.75),
            ...pickParam('ParamCheek', 0.55),
            ...pickParam('ParamEyeBallX', -0.25),
            ...pickParam('ParamEyeBallY', -0.18),
            ...pickParam('ParamBrowLY', -0.22),
            ...pickParam('ParamBrowRY', 0.15),
            ...pickParam('ParamMouthForm', -0.25),
            ...pickParam('ParamAngleX', -0.15),
            ...pickParam('ParamAngleZ', -0.12),
          },
        },
      ],
    },
    {
      id: 'shy',
      label: '害羞·低头垂眸',
      group: '害羞',
      emotion: 'shy',
      fallbackDesc: '脸红微讶 · 低头垂眸羞怯',
      re: /脸红|红晕|害羞|捂脸|blush|shy/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '脸红微讶',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.8),
            ...pickParam('ParamCheek', 0.6),
            ...pickParam('ParamAngleY', 0.1),
            ...pickParam('ParamEyeBallY', 0.1),
          },
        },
        {
          label: '低头羞怯',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.6),
            ...pickParam('ParamCheek', 0.75),
            ...pickParam('ParamEyeLSmile', 0.6),
            ...pickParam('ParamEyeRSmile', 0.6),
            ...pickParam('ParamAngleY', -0.2),
            ...pickParam('ParamAngleZ', 0.18),
            ...pickParam('ParamBodyAngleZ', 0.08),
            ...pickParam('ParamEyeBallX', 0.18),
            ...pickParam('ParamEyeBallY', -0.22),
            ...pickParam('ParamMouthForm', 0.4),
          },
        },
      ],
    },
    {
      id: 'shy_peek',
      label: '害羞·脸红偷瞄',
      group: '害羞',
      emotion: 'shy',
      fallbackDesc: '侧头羞怯 · 悄悄抬眼偷看',
      re: /脸红|红晕|害羞|blush|shy/i,
      finishMode: 'revert',
      revertHoldMs: 2000,
      stepDefs: [
        {
          label: '羞怯偏头',
          durationMs: 800,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.65),
            ...pickParam('ParamCheek', 0.65),
            ...pickParam('ParamAngleX', -0.18),
            ...pickParam('ParamAngleZ', -0.14),
            ...pickParam('ParamEyeBallX', -0.2),
            ...pickParam('ParamEyeBallY', -0.18),
          },
        },
        {
          label: '抬眼偷瞄',
          durationMs: 850,
          holdMs: 1000,
          params: {
            ...pickAbsoluteEye(0.75),
            ...pickParam('ParamCheek', 0.8),
            ...pickParam('ParamEyeLSmile', 0.55),
            ...pickParam('ParamEyeRSmile', 0.55),
            ...pickParam('ParamAngleX', -0.1),
            ...pickParam('ParamAngleZ', -0.1),
            ...pickParam('ParamEyeBallX', 0.18),
            ...pickParam('ParamEyeBallY', 0.12),
            ...pickParam('ParamMouthForm', 0.35),
          },
        },
      ],
    },
  ]

  for (const spec of specs) {
    const matched = pickControls(spec.re, 1)
    const ctrlIds = Array.from(new Set([...defaultActiveIds, ...matched.map((m) => m.id)]))
    const lastStepParams = spec.stepDefs[spec.stepDefs.length - 1]?.params ?? {}
    const steps: PresetKeyframeStep[] = spec.stepDefs.map((sd) => ({
      label: sd.label,
      durationMs: sd.durationMs,
      holdMs: sd.holdMs,
      controls: [...ctrlIds],
      parameters: sd.params,
    }))
    const descParts: string[] = []
    if (matched.length > 0) {
      descParts.push(matched.map((m) => m.label.split(' (')[0]).join(' + '))
    }
    if (Object.keys(lastStepParams).length > 0) {
      descParts.push(spec.fallbackDesc)
    }
    presets.push({
      id: spec.id,
      label: spec.label,
      description: descParts.join(' · ') || spec.fallbackDesc,
      emotion: spec.emotion,
      group: spec.group,
      controls: ctrlIds,
      parameters: lastStepParams,
      steps,
      finishMode: spec.finishMode,
      ...(spec.revertHoldMs ? { revertHoldMs: spec.revertHoldMs } : {}),
      custom: true,
    })
  }
  return presets
}


import { Application } from '@pixi/app'
import { extensions } from '@pixi/extensions'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4'
import type { Cubism4InternalModel } from 'pixi-live2d-display/cubism4'

Live2DModel.registerTicker(Ticker)
extensions.add(TickerPlugin)
;(window as any).PIXI = (window as any).PIXI || {}
;(window as any).PIXI.Ticker = Ticker

/**
 * 画布按逻辑尺寸的 RESOLUTION 倍渲染再用 CSS 缩回去，用来换取清晰度。
 * 因此：模型的 position/scale 用「逻辑坐标」，而 model.focus() 这类
 * 走 worldTransform 的 API 需要「逻辑坐标 × RESOLUTION」。
 */
export const RESOLUTION = 2

export type DeskpetModel = Live2DModel<Cubism4InternalModel>

/**
 * 模型尺寸属于模型实例，不再用模块级全局量。
 * 之前两个模型切换时会互相覆盖 refW/refH，导致缩放与拖拽钳制用错基准。
 */
export interface ModelMetrics {
  refW: number
  refH: number
}

const DEFAULT_METRICS: ModelMetrics = { refW: 100, refH: 100 }
const modelMetrics = new WeakMap<object, ModelMetrics>()
const modelFocusOrigins = new WeakMap<object, { x: number; y: number }>()

export function getModelMetrics(model: DeskpetModel): ModelMetrics {
  return modelMetrics.get(model as unknown as object) ?? DEFAULT_METRICS
}

function setModelMetrics(model: DeskpetModel, refW: number, refH: number): void {
  modelMetrics.set(model as unknown as object, {
    refW: refW > 0 ? refW : DEFAULT_METRICS.refW,
    refH: refH > 0 ? refH : DEFAULT_METRICS.refH,
  })
}

const EYE_FOCUS_PARAM_RE = /^(Param)?(EyeBall[XY]|Eye[LR]Open)$/i
const HEAD_FOCUS_PARAM_RE = /^(Param)?Angle[XY]$/i

/**
 * 自动检测模型双眼中点在 internalModel (0..originalWidth, 0..originalHeight) 坐标系中的精确位置。
 * 原生 pixi-live2d-display 默认把画布几何中心 (originalWidth/2, originalHeight/2，全身模型通常在腰胯部)
 * 当作视线原点，且用 Math.cos/sin 强行投影到单位圆，导致鼠标移到脸部时无法正视屏幕。
 */
function detectModelFocusOrigin(model: DeskpetModel): { x: number; y: number } {
  const internalModel = (model as any).internalModel
  const origW = Number(internalModel?.originalWidth) || model.width || 100
  const origH = Number(internalModel?.originalHeight) || model.height || 100
  const fallback = { x: origW * 0.5, y: origH * 0.32 }

  const rawModel = internalModel?.coreModel?._model
  const drawables = rawModel?.drawables
  const canvasinfo = rawModel?.canvasinfo
  const params = rawModel?.parameters
  if (
    !rawModel ||
    !drawables ||
    !Array.isArray(drawables.vertexPositions) ||
    !canvasinfo ||
    !params ||
    !Array.isArray(params.ids) ||
    typeof rawModel.update !== 'function'
  ) {
    return fallback
  }

  let targetIndices: number[] = []
  for (let i = 0; i < params.ids.length; i++) {
    if (EYE_FOCUS_PARAM_RE.test(String(params.ids[i]))) {
      targetIndices.push(i)
    }
  }
  if (targetIndices.length === 0) {
    for (let i = 0; i < params.ids.length; i++) {
      if (HEAD_FOCUS_PARAM_RE.test(String(params.ids[i]))) {
        targetIndices.push(i)
      }
    }
  }
  if (targetIndices.length === 0) return fallback

  const ppu = Number(canvasinfo.PixelsPerUnit) || Number(internalModel?.pixelsPerUnit) || 1000
  const halfW = (Number(canvasinfo.CanvasWidth) || origW) / (2 * ppu)
  const halfH = (Number(canvasinfo.CanvasHeight) || origH) / (2 * ppu)
  const savedParams = Float32Array.from(params.values)

  try {
    for (let i = 0; i < params.values.length; i++) {
      params.values[i] = params.defaultValues?.[i] ?? 0
    }
    rawModel.update()
    const posDefault = drawables.vertexPositions.map((arr: Float32Array) => Float32Array.from(arr))

    for (const idx of targetIndices) {
      const def = params.defaultValues?.[idx] ?? 0
      const min = params.minimumValues?.[idx] ?? -1
      const max = params.maximumValues?.[idx] ?? 1
      params.values[idx] = Math.abs(max - def) >= Math.abs(min - def) ? max : min
    }
    rawModel.update()

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let d = 0; d < drawables.vertexPositions.length; d++) {
      const v0 = posDefault[d]
      const v1 = drawables.vertexPositions[d]
      if (!v0 || !v1 || v0.length !== v1.length) continue
      for (let i = 0; i < v1.length; i += 2) {
        const vx0 = v0[i]
        const vy0 = v0[i + 1]
        const vx1 = v1[i]
        const vy1 = v1[i + 1]
        if (Math.abs(vx0) > halfW || Math.abs(vy0) > halfH) continue
        const moved = Math.abs(vx1 - vx0) + Math.abs(vy1 - vy0)
        if (moved > 0.002) {
          if (vx0 < minX) minX = vx0
          if (vx0 > maxX) maxX = vx0
          if (vy0 < minY) minY = vy0
          if (vy0 > maxY) maxY = vy0
        }
      }
    }

    if (minX <= maxX && minY <= maxY) {
      const cx = (minX + maxX) * 0.5
      const cy = (minY + maxY) * 0.5
      return {
        x: cx * ppu + origW * 0.5,
        y: -cy * ppu + origH * 0.5,
      }
    }
    return fallback
  } catch {
    return fallback
  } finally {
    for (let i = 0; i < savedParams.length; i++) {
      params.values[i] = savedParams[i]
    }
    try {
      rawModel.update()
    } catch {
      /* ignore */
    }
  }
}

export function getModelFocusOrigin(model: DeskpetModel): { x: number; y: number } {
  const key = model as unknown as object
  let origin = modelFocusOrigins.get(key)
  if (!origin) {
    origin = detectModelFocusOrigin(model)
    modelFocusOrigins.set(key, origin)
  }
  return origin
}

/**
 * 精准鼠标视角跟随：
 *   - 以模型真实双眼中心为原点，当光标移至模型面部中心时 (nx, ny) = (0, 0)，使模型自然正视屏幕；
 *   - 在单位圆内按光标与眼部距离线性比例响应，在单位圆外平滑钳制到模长 1.0，修复 pixi-live2d-display
 *     原生 focus() 使用 Math.cos(radian)/-Math.sin(radian) 丢弃距离导致永远处于最大偏角的问题。
 */
export function focusLive2DModel(
  model: DeskpetModel,
  canvasX: number,
  canvasY: number,
  instant = false,
): void {
  const internalModel = (model as any)?.internalModel
  const fc = internalModel?.focusController
  if (!fc || typeof fc.focus !== 'function') return

  const pt = { x: canvasX, y: canvasY }
  if (typeof (model as any).toModelPosition === 'function') {
    ;(model as any).toModelPosition(pt, pt, false)
  }

  const origW = Number(internalModel.originalWidth) || model.width || 100
  const origH = Number(internalModel.originalHeight) || model.height || 100
  const origin = getModelFocusOrigin(model)
  const span = Math.max(1, Math.min(origW, origH) * 0.45)

  let nx = (pt.x - origin.x) / span
  let ny = -(pt.y - origin.y) / span
  const dist = Math.hypot(nx, ny)
  if (dist > 1) {
    nx /= dist
    ny /= dist
  }
  fc.focus(nx, ny, instant)
}

export async function createPixiApp(container: HTMLElement, width: number, height: number): Promise<Application> {
  const app = new Application({
    width: width * RESOLUTION,
    height: height * RESOLUTION,
    backgroundAlpha: 0,
    preserveDrawingBuffer: false,
    resolution: 1,
    autoDensity: false,
  })
  app.stage.scale.set(RESOLUTION)

  const canvas = app.view as HTMLCanvasElement
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.objectFit = 'cover'
  canvas.style.display = 'block'
  container.appendChild(canvas)
  return app
}

/**
 * 准备阶段：只加载并量取尺寸，不加入可见舞台。
 * 调用方校验通过后再 attachLive2DModel，避免加载失败时旧模型已被卸掉。
 */
export async function createLive2DModel(modelPath: string): Promise<DeskpetModel> {
  const model = (await Live2DModel.from(modelPath, {
    autoInteract: false,
    autoUpdate: true,
  })) as DeskpetModel
  model.anchor.set(0.5, 0.5)
  setModelMetrics(model, model.width || 100, model.height || 100)
  getModelFocusOrigin(model)
  ;(model as any).focus = (x: number, y: number, instant = false) => {
    focusLive2DModel(model, x, y, instant)
  }
  return model
}

/** 提交阶段：按当前窗口尺寸把已准备好的模型放到舞台中央并显示。 */
export function attachLive2DModel(model: DeskpetModel, app: Application): void {
  const { refW, refH } = getModelMetrics(model)
  const cw = app.view.width / RESOLUTION
  const ch = app.view.height / RESOLUTION
  const scale = Math.min((cw * 0.85) / refW, (ch * 0.85) / refH)

  model.scale.set(scale)
  model.position.set(cw / 2, ch / 2)
  if (!(app.stage.children as unknown[]).includes(model as unknown)) {
    app.stage.addChild(model)
  }
}

/** 一次性加载并上舞台（初次挂载用；热切换请走 create + attach 两步）。 */
export async function loadLive2DModel(modelPath: string, app: Application): Promise<DeskpetModel> {
  const model = await createLive2DModel(modelPath)
  attachLive2DModel(model, app)
  return model
}

/** 丢弃一个尚未提交（或已从舞台移除）的模型，释放纹理。 */
export function discardLive2DModel(model: DeskpetModel): void {
  try {
    model.destroy({ children: true, texture: true, baseTexture: true })
  } catch (err) {
    console.warn('[Deskpet] Failed to discard prepared model:', err)
  }
}

/** 热切换模型时移除并释放旧模型，避免纹理/WebGL 资源泄漏。 */
export function unloadLive2DModel(model: DeskpetModel, app: Application): void {
  try {
    app.stage.removeChild(model)
    model.destroy({ children: true, texture: true, baseTexture: true })
  } catch (err) {
    console.warn('[Deskpet] Failed to destroy model cleanly:', err)
  }
}

/** 模型实际拥有的 motion 组名（来自 .model3.json 的 Motions）。 */
export function getMotionGroups(model: DeskpetModel): string[] {
  const definitions = model.internalModel?.motionManager?.definitions
  if (!definitions) return []
  return Object.keys(definitions).filter((group) => (definitions[group]?.length ?? 0) > 0)
}

/** 每个 motion 组里有几条动作，写 adapter 时 index 不能越界。 */
export function getMotionGroupSizes(model: DeskpetModel): Record<string, number> {
  const definitions = model.internalModel?.motionManager?.definitions
  const sizes: Record<string, number> = {}
  if (!definitions) return sizes
  for (const [group, list] of Object.entries(definitions)) {
    sizes[group] = list?.length ?? 0
  }
  return sizes
}

/** 已注册到 .model3.json 的表情名。exp3 文件存在但没注册的话，这里是空的。 */
export function getExpressionNames(model: DeskpetModel): string[] {
  const definitions = (model.internalModel?.motionManager as any)?.expressionManager?.definitions
  if (!Array.isArray(definitions)) return []
  return definitions
    .map((def: any) => def?.Name ?? def?.name)
    .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
}

export interface ParameterInfo {
  id: string
  min: number
  max: number
  default: number
  name?: string
  group?: string
  isPhysicsOutput?: boolean
}

export interface PartInfo {
  id: string
  name?: string
}

export interface ModelExpressionAssetInfo {
  name: string
  file: string
  parameters: Array<{ id: string; value: number; blend?: string }>
}

export interface ModelDiskAssetsInfo {
  cdiParameters: Record<string, { name: string; group: string }>
  cdiParts: Record<string, string>
  physicsOutputIds: string[]
  vtubeHotkeys: Record<string, string>
  expressions: ModelExpressionAssetInfo[]
  poseGroups?: string[][]
  savedPresets?: Array<{
    id: string
    label: string
    description: string
    emotion: string
    group?: string
    controls: string[]
    parameters?: Record<string, number>
    steps?: Array<{
      label?: string
      durationMs: number
      holdMs: number
      controls: string[]
      parameters: Record<string, number>
    }>
    finishMode?: 'hold' | 'revert' | 'loop'
    revertHoldMs?: number
    motion?: { group: string; index?: number } | 'none'
    custom?: boolean
  }> | null
}

/**
 * 模型真实存在的参数清单。
 *
 * 这是写 adapter 时最关键、也最拿不到的信息：参数 ID 存在 .moc3 二进制里，
 * .cdi3.json 会列出来但不是必需文件（很多模型没有）。所以只能从运行时的
 * core model 里读。注意 setParameterValueById 对不存在的参数是静默写入
 * 幻影槽位，不会报错 —— 所以必须显式对照这份清单校验。
 */
export function getParameterInfos(model: DeskpetModel, diskAssets?: ModelDiskAssetsInfo | null): ParameterInfo[] {
  const coreModel = (model.internalModel as any)?.coreModel
  if (!coreModel?.getParameterCount) return []

  const physicsSet = new Set(diskAssets?.physicsOutputIds ?? [])
  const cdiParams = diskAssets?.cdiParameters ?? {}
  const ids: string[] = coreModel._parameterIds ?? []
  const count: number = coreModel.getParameterCount()
  const infos: ParameterInfo[] = []
  for (let i = 0; i < count; i++) {
    const id = ids[i]
    if (typeof id !== 'string') continue
    const cdi = cdiParams[id]
    infos.push({
      id,
      min: coreModel.getParameterMinimumValue?.(i) ?? 0,
      max: coreModel.getParameterMaximumValue?.(i) ?? 0,
      default: coreModel.getParameterDefaultValue?.(i) ?? 0,
      ...(cdi?.name ? { name: cdi.name } : {}),
      ...(cdi?.group ? { group: cdi.group } : {}),
      ...(physicsSet.has(id) ? { isPhysicsOutput: true } : {}),
    })
  }
  return infos
}

export function getPartInfos(model: DeskpetModel, diskAssets?: ModelDiskAssetsInfo | null): PartInfo[] {
  const coreModel = (model.internalModel as any)?.coreModel
  const ids: string[] = coreModel?._partIds ?? []
  if (!Array.isArray(ids)) return []
  const cdiParts = diskAssets?.cdiParts ?? {}
  const parts: PartInfo[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue
    const name = cdiParts[id]
    parts.push({ id, ...(name ? { name } : {}) })
  }
  return parts
}

export interface ModelCapabilities {
  modelUrl: string
  motionGroups: Record<string, number>
  expressions: string[]
  unregisteredExpressions?: string[]
  parameters: ParameterInfo[]
  parts?: PartInfo[]
  poseGroups?: string[][]
  baseParameters?: Record<string, number>
  controls?: Array<{
    id: string
    label: string
    category: string
    parameters: Record<string, number>
    active: boolean
    source: 'adapter' | 'auto'
  }>
}

/** 汇总模型能力，用来喂给 AI 生成 deskpet-adapter.json，同时暴露已发现的控件与水印底层参数。 */
export function describeModel(
  model: DeskpetModel,
  modelUrl: string,
  diskAssets?: ModelDiskAssetsInfo | null,
): ModelCapabilities {
  const registered = getExpressionNames(model)
  const registeredSet = new Set(registered.map((n) => n.toLowerCase()))
  const unregistered = (diskAssets?.expressions ?? [])
    .map((e) => e.name)
    .filter((name) => !registeredSet.has(name.toLowerCase()))
  const parts = getPartInfos(model, diskAssets)
  const poseGroups = diskAssets?.poseGroups ?? []

  return {
    modelUrl,
    motionGroups: getMotionGroupSizes(model),
    expressions: registered,
    ...(unregistered.length > 0 ? { unregisteredExpressions: unregistered } : {}),
    parameters: getParameterInfos(model, diskAssets),
    ...(parts.length > 0 ? { parts } : {}),
    ...(poseGroups.length > 0 ? { poseGroups } : {}),
  }
}

/**
 * 播放动作。库的 motion() 返回 Promise<boolean>：true = 已开始播放，
 * false = 动作组/index 不存在。调用方据此判断是否虚报成功。
 */
export async function playMotion(model: DeskpetModel, name: string, idx = 0): Promise<boolean> {
  try {
    const result = await model.motion(name, idx, MotionPriority.FORCE)
    return result !== false
  } catch (err) {
    console.debug(`[Deskpet] Motion not available: ${name}[${idx}]`, err)
    return false
  }
}

/**
 * 订阅"动作自然播放结束"事件（MotionManager 的 motionFinish）。
 * 循环续播依赖它；返回取消订阅函数，模型销毁后调用也安全。
 */
export function onMotionFinish(model: DeskpetModel, handler: () => void): () => void {
  const manager = (model as any)?.internalModel?.motionManager
  if (typeof manager?.on !== 'function') return () => {}
  const listener = () => handler()
  manager.on('motionFinish', listener)
  return () => {
    try {
      manager.off?.('motionFinish', listener)
    } catch {
      /* 模型可能已销毁 */
    }
  }
}

export function setExpression(model: DeskpetModel, id: string) {
  try {
    model.expression(id)
  } catch (err) {
    console.debug(`[Deskpet] Expression not available: ${id}`, err)
  }
}

/**
 * 淡出当前激活的表情。表情是 Add 混合、由 ExpressionManager 每帧叠加，
 * 把底层参数写回 0 抵消不掉，必须走这里。
 */
export function clearExpression(model: DeskpetModel) {
  try {
    ;((model.internalModel?.motionManager as any)?.expressionManager)?.resetExpression?.()
  } catch (err) {
    console.debug('[Deskpet] Failed to reset expression', err)
  }
}

/**
 * 三层参数栈 + 部件显隐层：
 *   1. base（底层常驻：去除水印、修正模型默认姿态）
 *   2. controls（持久控件层：服饰、发型、道具、脸部特效开关）
 *   3. emotion（瞬态情绪层：6 秒后回退到 neutral 时只释放本层，绝不冲掉水印和已开控件）
 */
interface CollapsedDrawableVertices {
  drawableIndex: number
  floatOffsets: number[]
}

export interface ParameterTransitionOptions {
  /** 过渡动画时长（毫秒）。0 或不传表示立即生效；> 0 时按三次缓出平滑插值 */
  transitionMs?: number
}

interface ValueTransition {
  from: number
  to: number
  startTime: number
  duration: number
  releaseOnComplete: boolean
}

interface ModelParameterStack {
  base: Record<string, number>
  controls: Record<string, number>
  emotion: Record<string, number>
  appliedIds: Set<string>
  currentValues: Map<string, number>
  paramTransitions: Map<string, ValueTransition>
  hiddenParts: Set<string>
  appliedHiddenParts: Set<string>
  shownParts: Set<string>
  appliedShownParts: Set<string>
  currentPartOpacities: Map<string, number>
  partTransitions: Map<string, ValueTransition>
  collapsedVertices: CollapsedDrawableVertices[]
  sequenceGazeOverride: boolean
  focusWeight: number
  focusTransition: ValueTransition | null
  lipSyncParam: string
  lipSyncValue: number
  lipSyncActive: boolean
  hooked: boolean
  naturalMovementsWrapped: boolean
  focusUpdateWrapped: boolean
  coreUpdateWrapped: boolean
  lastParamStepFrameNow: number
}

const modelStacks = new WeakMap<object, ModelParameterStack>()

function getModelStack(model: DeskpetModel): ModelParameterStack {
  const key = model as unknown as object
  let stack = modelStacks.get(key)
  if (!stack) {
    stack = {
      base: {},
      controls: {},
      emotion: {},
      appliedIds: new Set<string>(),
      currentValues: new Map<string, number>(),
      paramTransitions: new Map<string, ValueTransition>(),
      hiddenParts: new Set<string>(),
      appliedHiddenParts: new Set<string>(),
      shownParts: new Set<string>(),
      appliedShownParts: new Set<string>(),
      currentPartOpacities: new Map<string, number>(),
      partTransitions: new Map<string, ValueTransition>(),
      collapsedVertices: [],
      sequenceGazeOverride: false,
      focusWeight: 1,
      focusTransition: null,
      lipSyncParam: 'ParamMouthOpenY',
      lipSyncValue: 0,
      lipSyncActive: false,
      hooked: false,
      naturalMovementsWrapped: false,
      focusUpdateWrapped: false,
      coreUpdateWrapped: false,
      lastParamStepFrameNow: -1,
    }
    modelStacks.set(key, stack)
  }
  return stack
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - clamped, 3)
}

function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

function getEffectiveFocusWeight(stack: ModelParameterStack, now: number): number {
  const tr = stack.focusTransition
  if (!tr) return stack.focusWeight
  const rawT = tr.duration > 0 ? (now - tr.startTime) / tr.duration : 1
  if (rawT >= 1) {
    stack.focusWeight = tr.to
    stack.focusTransition = null
    return tr.to
  }
  const eased = easeInOutCubic(rawT)
  const val = tr.from + (tr.to - tr.from) * eased
  stack.focusWeight = val
  return val
}

function getCoreDefaultParamValue(coreModel: any, id: string): number {
  try {
    if (typeof coreModel.getParameterDefaultValueById === 'function') {
      const v = coreModel.getParameterDefaultValueById(id)
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
  } catch {
    /* ignore */
  }
  return 0
}

const ADDITIVE_MOTION_PARAM_RE =
  /^(Param)?(Angle[XYZ]|BodyAngle[XYZ]|Shoulder|Leg|Step|Position[XYZ])$/i
const EYE_BALL_PARAM_RE = /^(Param)?EyeBall[XY]$/i
const EYE_OPEN_PARAM_RE = /^ParamEye[LR]Open$/i

function getCoreCurrentParamValue(
  coreModel: any,
  stack: ModelParameterStack,
  id: string,
): number {
  const tracked = stack.currentValues.get(id)
  if (typeof tracked === 'number' && Number.isFinite(tracked)) {
    return tracked
  }
  // 对于叠加型姿态参数与眨眼缩放参数，未在参数栈中激活时的基准目标值即模型默认值；
  // 若直接读取 coreModel 当前值，会把正在播放的待机动画或鼠标跟随值误当作参数栈初始偏移，导致过渡首帧跳变。
  // 注意：眼球参数（ParamEyeBallX/Y）在预设中采用绝对朝向控制，因此首次进入过渡时直接读取 coreModel 当前真实视线位置作为起点。
  if (ADDITIVE_MOTION_PARAM_RE.test(id) || EYE_OPEN_PARAM_RE.test(id)) {
    return getCoreDefaultParamValue(coreModel, id)
  }
  try {
    if (typeof coreModel.getParameterValueById === 'function') {
      const v = coreModel.getParameterValueById(id)
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
  } catch {
    /* ignore */
  }
  return getCoreDefaultParamValue(coreModel, id)
}

function updateSavedParamOnly(coreModel: any, id: string, value: number): void {
  if (
    ADDITIVE_MOTION_PARAM_RE.test(id) ||
    EYE_BALL_PARAM_RE.test(id) ||
    EYE_OPEN_PARAM_RE.test(id)
  ) {
    return
  }
  try {
    const ids = coreModel?._model?.parameters?.ids
    const saved = coreModel?._savedParameters
    if (Array.isArray(ids) && Array.isArray(saved)) {
      const idx = ids.indexOf(id)
      if (idx >= 0 && idx < saved.length) {
        saved[idx] = value
      }
    }
  } catch {
    /* ignore */
  }
}

function setCoreParamAndSaved(coreModel: any, id: string, value: number, isRelease = false): void {
  try {
    coreModel.setParameterValueById(id, value)
  } catch (err) {
    console.debug(`[Deskpet] Parameter not available: ${id}`, err)
  }
  // 对于叠加型姿态参数、眼球视线参数与眨眼参数，仅在立即释放（无过渡）时写入 _savedParameters，
  // 避免污染 saveParameters/loadParameters 快照导致鼠标视线追踪或待机动画累加漂移
  if (
    !isRelease &&
    (ADDITIVE_MOTION_PARAM_RE.test(id) ||
      EYE_BALL_PARAM_RE.test(id) ||
      EYE_OPEN_PARAM_RE.test(id))
  ) {
    return
  }
  try {
    const ids = coreModel?._model?.parameters?.ids
    const saved = coreModel?._savedParameters
    if (Array.isArray(ids) && Array.isArray(saved)) {
      const idx = ids.indexOf(id)
      if (idx >= 0 && idx < saved.length) {
        saved[idx] = value
      }
    }
  } catch {
    /* ignore */
  }
}

function applyLiveParameterInFrame(
  coreModel: any,
  id: string,
  targetVal: number,
  isBaseWatermark: boolean,
): void {
  if (!isBaseWatermark && typeof coreModel.getParameterValueById === 'function') {
    try {
      const animVal = coreModel.getParameterValueById(id)
      if (typeof animVal === 'number' && Number.isFinite(animVal)) {
        const defaultVal = getCoreDefaultParamValue(coreModel, id)
        if (EYE_BALL_PARAM_RE.test(id)) {
          coreModel.setParameterValueById(id, targetVal)
          return
        }
        if (ADDITIVE_MOTION_PARAM_RE.test(id)) {
          const delta = targetVal - defaultVal
          coreModel.setParameterValueById(id, animVal + delta)
          return
        }
        if (EYE_OPEN_PARAM_RE.test(id)) {
          const baseOpen = defaultVal > 0 ? defaultVal : 1
          if (targetVal <= baseOpen) {
            const scaled = animVal * (targetVal / baseOpen)
            coreModel.setParameterValueById(id, Math.min(animVal, scaled))
            return
          }
        }
      }
    } catch {
      /* fallback to direct set below */
    }
  }
  try {
    coreModel.setParameterValueById(id, targetVal)
  } catch {
    /* ignore */
  }
}

function stepStackParametersInFrame(
  currentCore: any,
  stack: ModelParameterStack,
  now: number,
): void {
  const activeMerged: Record<string, number> = {
    ...stack.base,
    ...stack.controls,
    ...stack.emotion,
  }

  for (const [id, value] of Object.entries(activeMerged)) {
    if (stack.paramTransitions.has(id)) continue
    stack.currentValues.set(id, value)
    const isBaseOnly = (id in stack.base) && !(id in stack.controls) && !(id in stack.emotion)
    applyLiveParameterInFrame(currentCore, id, value, isBaseOnly)
  }

  for (const [id, tr] of [...stack.paramTransitions.entries()]) {
    const rawT = tr.duration > 0 ? (now - tr.startTime) / tr.duration : 1
    const eased = easeInOutCubic(rawT)
    const val = tr.from + (tr.to - tr.from) * eased
    stack.currentValues.set(id, val)
    // 注意：正在过渡（含释放淡出 releaseOnComplete=true）的参数绝不能当作 baseWatermark，
    // 否则会在淡出首帧跳过叠加逻辑直接硬写 coreModel 造成闪烁跳变
    const isBaseOnly =
      !tr.releaseOnComplete &&
      id in stack.base &&
      !(id in stack.controls) &&
      !(id in stack.emotion)

    if (rawT >= 1) {
      if (tr.releaseOnComplete && EYE_BALL_PARAM_RE.test(id)) {
        // 眼球参数释放完成时，currentCore 已处于当前帧的实时视线 animVal，无需再用默认值 0 覆盖，避免单帧归零闪烁
        updateSavedParamOnly(currentCore, id, tr.to)
        stack.paramTransitions.delete(id)
        stack.currentValues.delete(id)
        stack.appliedIds.delete(id)
        continue
      }
      // 必须先调用 applyLiveParameterInFrame（此时 currentCore 中仍是未污染的 animVal），
      // 绝不能先调 setCoreParamAndSaved 覆盖 currentCore，否则会导致 animVal 被变成 tr.to 而产生 2 倍尖峰闪烁
      applyLiveParameterInFrame(currentCore, id, tr.to, isBaseOnly)
      updateSavedParamOnly(currentCore, id, tr.to)
      stack.paramTransitions.delete(id)
      if (tr.releaseOnComplete) {
        stack.currentValues.delete(id)
        stack.appliedIds.delete(id)
      } else {
        stack.currentValues.set(id, tr.to)
      }
    } else {
      // 眼球视线在释放淡出（releaseOnComplete=true）时，从分镜值平滑插值回当前实时视线 animVal
      if (
        tr.releaseOnComplete &&
        EYE_BALL_PARAM_RE.test(id) &&
        typeof currentCore.getParameterValueById === 'function'
      ) {
        try {
          const animVal = currentCore.getParameterValueById(id)
          if (typeof animVal === 'number' && Number.isFinite(animVal)) {
            const blended = tr.from + (animVal - tr.from) * eased
            stack.currentValues.set(id, blended)
            currentCore.setParameterValueById(id, blended)
            continue
          }
        } catch {
          /* fallback */
        }
      }
      applyLiveParameterInFrame(currentCore, id, val, isBaseOnly)
    }
  }
}

function stepStackPartsInFrame(
  currentCore: any,
  stack: ModelParameterStack,
  now: number,
): void {
  for (const partId of stack.hiddenParts) {
    if (stack.partTransitions.has(partId)) continue
    stack.currentPartOpacities.set(partId, 0)
    try {
      setPartOpacityOnCore(currentCore, partId, 0)
    } catch {
      /* ignore */
    }
  }

  for (const partId of stack.shownParts) {
    if (stack.partTransitions.has(partId)) continue
    stack.currentPartOpacities.set(partId, 1)
    try {
      setPartOpacityOnCore(currentCore, partId, 1)
    } catch {
      /* ignore */
    }
  }

  for (const [partId, tr] of [...stack.partTransitions.entries()]) {
    const rawT = tr.duration > 0 ? (now - tr.startTime) / tr.duration : 1
    const eased = easeInOutCubic(rawT)
    const op = tr.from + (tr.to - tr.from) * eased
    stack.currentPartOpacities.set(partId, op)
    try {
      setPartOpacityOnCore(currentCore, partId, op)
    } catch {
      /* ignore */
    }
    if (rawT >= 1) {
      stack.partTransitions.delete(partId)
      if (tr.releaseOnComplete) {
        stack.currentPartOpacities.delete(partId)
        stack.appliedHiddenParts.delete(partId)
        stack.appliedShownParts.delete(partId)
      }
    }
  }
}

function setPartOpacityOnCore(coreModel: any, partId: string, opacity: number): void {
  if (typeof coreModel.setPartOpacityById === 'function') {
    coreModel.setPartOpacityById(partId, opacity)
    return
  }
  if (Array.isArray(coreModel._partIds) && typeof coreModel.setPartOpacityByIndex === 'function') {
    const idx = coreModel._partIds.indexOf(partId)
    if (idx >= 0) coreModel.setPartOpacityByIndex(idx, opacity)
  }
}

/**
 * 许多 VTube Studio 模型（如 RetrynowMiku）在关闭水印时不是把透明度设为 0，
 * 而是通过变形器把水印顶点（甚至合并在脸部网格 ArtMesh77 末尾的水印子网格）平移到画布顶边之外。
 * 由于桌宠竖屏窗口不会按模型画布边界裁剪，移出画布的水印仍会悬浮在角色头顶。
 * 这里在设置 baseParameters 时对比默认态与激活态：凡是被 baseParameters 推到画布边界外的顶点，
 * 在每帧 coreModel.update() 后折叠到 (0, 0) 形成零面积三角形，彻底消除残留水印且不影响同网格内的正常脸部顶点。
 */
function detectOffCanvasBaseVertices(
  coreModel: any,
  baseParams: Record<string, number>,
): CollapsedDrawableVertices[] {
  const rawModel = coreModel?._model
  const drawables = rawModel?.drawables
  const canvasinfo = rawModel?.canvasinfo
  const params = rawModel?.parameters
  if (
    !rawModel ||
    !drawables ||
    !Array.isArray(drawables.vertexPositions) ||
    !canvasinfo ||
    !params ||
    typeof rawModel.update !== 'function'
  ) {
    return []
  }

  const baseEntries = Object.entries(baseParams)
  if (baseEntries.length === 0) return []

  const ppu = Number(canvasinfo.PixelsPerUnit) || 1000
  const halfW = (Number(canvasinfo.CanvasWidth) || 2000) / (2 * ppu)
  const halfH = (Number(canvasinfo.CanvasHeight) || 2000) / (2 * ppu)

  const savedParams = Float32Array.from(params.values)

  try {
    for (const [id] of baseEntries) {
      const idx = Array.isArray(params.ids) ? params.ids.indexOf(id) : -1
      if (idx >= 0) {
        params.values[idx] = params.defaultValues?.[idx] ?? 0
      }
    }
    rawModel.update()
    const posDefault = drawables.vertexPositions.map((arr: Float32Array) => Float32Array.from(arr))

    for (const [id, val] of baseEntries) {
      const idx = Array.isArray(params.ids) ? params.ids.indexOf(id) : -1
      if (idx >= 0) {
        params.values[idx] = val
      }
    }
    rawModel.update()

    const result: CollapsedDrawableVertices[] = []
    for (let d = 0; d < drawables.vertexPositions.length; d++) {
      const v0 = posDefault[d]
      const v1 = drawables.vertexPositions[d]
      if (!v0 || !v1 || v0.length !== v1.length) continue
      const offsets: number[] = []
      for (let i = 0; i < v1.length; i += 2) {
        const moved = Math.abs(v1[i] - v0[i]) + Math.abs(v1[i + 1] - v0[i + 1])
        if (moved > 0.05 && (Math.abs(v1[i]) > halfW || Math.abs(v1[i + 1]) > halfH)) {
          offsets.push(i)
        }
      }
      if (offsets.length > 0) {
        result.push({ drawableIndex: d, floatOffsets: offsets })
      }
    }
    return result
  } catch {
    return []
  } finally {
    for (let i = 0; i < savedParams.length; i++) {
      params.values[i] = savedParams[i]
    }
    try {
      rawModel.update()
    } catch {
      /* ignore */
    }
  }
}

function applyCollapsedVertices(
  coreModel: any,
  collapsed: CollapsedDrawableVertices[],
): void {
  if (!collapsed.length) return
  const vertexPositions = coreModel?._model?.drawables?.vertexPositions
  if (!Array.isArray(vertexPositions)) return
  for (const item of collapsed) {
    const vp = vertexPositions[item.drawableIndex]
    if (!vp) continue
    for (const offset of item.floatOffsets) {
      vp[offset] = 0
      vp[offset + 1] = 0
    }
  }
}

function syncModelStack(model: DeskpetModel, transitionMs = 0, preserveInFlight = false): void {
  const coreModel = (model as any).internalModel?.coreModel
  if (!coreModel) return
  const stack = getModelStack(model)

  // 合并优先级：base < controls < emotion
  const merged: Record<string, number> = {
    ...stack.base,
    ...stack.controls,
    ...stack.emotion,
  }
  const currentIds = new Set(Object.keys(merged))

  if (transitionMs <= 0) {
    if (!preserveInFlight) {
      stack.paramTransitions.clear()
      stack.partTransitions.clear()
    }

    for (const id of stack.appliedIds) {
      if (currentIds.has(id)) continue
      const existingTr = preserveInFlight ? stack.paramTransitions.get(id) : undefined
      if (existingTr && existingTr.releaseOnComplete) {
        continue
      }
      stack.paramTransitions.delete(id)
      // 复位到模型自身的默认值，并同步更新 _savedParameters，防止 loadParameters() 恢复旧值
      const fallback = getCoreDefaultParamValue(coreModel, id)
      setCoreParamAndSaved(coreModel, id, fallback, true)
      stack.currentValues.delete(id)
    }

    for (const [id, value] of Object.entries(merged)) {
      const existingTr = preserveInFlight ? stack.paramTransitions.get(id) : undefined
      if (existingTr && !existingTr.releaseOnComplete && Math.abs(existingTr.to - value) < 1e-4) {
        continue
      }
      stack.paramTransitions.delete(id)
      setCoreParamAndSaved(coreModel, id, value, false)
      stack.currentValues.set(id, value)
    }

    stack.appliedIds = currentIds

    // 同步部件显隐状态（hiddenParts = 0 隐藏，shownParts = 1 强制显示，释放时恢复为 1）
    if (!preserveInFlight || stack.partTransitions.size === 0) {
      for (const partId of [...stack.appliedHiddenParts, ...stack.appliedShownParts]) {
        if (stack.hiddenParts.has(partId) || stack.shownParts.has(partId)) continue
        try {
          setPartOpacityOnCore(coreModel, partId, 1)
        } catch {
          /* ignore */
        }
        stack.currentPartOpacities.delete(partId)
      }
      for (const partId of stack.hiddenParts) {
        try {
          setPartOpacityOnCore(coreModel, partId, 0)
        } catch {
          /* ignore */
        }
        stack.currentPartOpacities.set(partId, 0)
      }
      for (const partId of stack.shownParts) {
        try {
          setPartOpacityOnCore(coreModel, partId, 1)
        } catch {
          /* ignore */
        }
        stack.currentPartOpacities.set(partId, 1)
      }
      stack.appliedHiddenParts = new Set(stack.hiddenParts)
      stack.appliedShownParts = new Set(stack.shownParts)
    }
  } else {
    const now = nowMs()

    // 1) 被移除的参数：先把非叠加型参数的 _savedParameters 复位为默认值（防止过渡结束后被 loadParameters 还原回旧值），
    //    同时通过 paramTransitions 从当前值平滑插值到默认值
    for (const id of [...stack.appliedIds]) {
      if (currentIds.has(id)) continue
      const fromVal = getCoreCurrentParamValue(coreModel, stack, id)
      const toVal = getCoreDefaultParamValue(coreModel, id)
      updateSavedParamOnly(coreModel, id, toVal)
      if (Math.abs(toVal - fromVal) > 1e-4) {
        stack.currentValues.set(id, fromVal)
        stack.paramTransitions.set(id, {
          from: fromVal,
          to: toVal,
          startTime: now,
          duration: transitionMs,
          releaseOnComplete: true,
        })
      } else {
        stack.paramTransitions.delete(id)
        stack.currentValues.delete(id)
        stack.appliedIds.delete(id)
      }
    }

    // 2) 新增或变更的目标参数：从当前值平滑插值到目标值（底层去水印参数保持立即生效）
    for (const [id, toVal] of Object.entries(merged)) {
      stack.appliedIds.add(id)
      const isBaseOnly = (id in stack.base) && !(id in stack.controls) && !(id in stack.emotion)
      if (isBaseOnly) {
        stack.paramTransitions.delete(id)
        stack.currentValues.set(id, toVal)
        setCoreParamAndSaved(coreModel, id, toVal, false)
        continue
      }
      const fromVal = getCoreCurrentParamValue(coreModel, stack, id)
      if (Math.abs(toVal - fromVal) > 1e-4) {
        stack.currentValues.set(id, fromVal)
        stack.paramTransitions.set(id, {
          from: fromVal,
          to: toVal,
          startTime: now,
          duration: transitionMs,
          releaseOnComplete: false,
        })
      } else {
        stack.paramTransitions.delete(id)
        stack.currentValues.set(id, toVal)
        updateSavedParamOnly(coreModel, id, toVal)
      }
    }

    // 3) 部件显隐透明度平滑渐变（hiddenParts -> 0，shownParts -> 1，释放 -> 1）
    for (const partId of [...stack.appliedHiddenParts, ...stack.appliedShownParts]) {
      if (stack.hiddenParts.has(partId) || stack.shownParts.has(partId)) continue
      const fromOp = stack.currentPartOpacities.get(partId) ?? 0
      if (fromOp < 1 - 1e-3) {
        stack.partTransitions.set(partId, {
          from: fromOp,
          to: 1,
          startTime: now,
          duration: transitionMs,
          releaseOnComplete: true,
        })
      } else {
        stack.partTransitions.delete(partId)
        stack.currentPartOpacities.delete(partId)
        stack.appliedHiddenParts.delete(partId)
        stack.appliedShownParts.delete(partId)
        try {
          setPartOpacityOnCore(coreModel, partId, 1)
        } catch {
          /* ignore */
        }
      }
    }
    for (const partId of stack.hiddenParts) {
      stack.appliedHiddenParts.add(partId)
      stack.appliedShownParts.delete(partId)
      const fromOp = stack.currentPartOpacities.get(partId) ?? 1
      if (fromOp > 1e-3) {
        stack.partTransitions.set(partId, {
          from: fromOp,
          to: 0,
          startTime: now,
          duration: transitionMs,
          releaseOnComplete: false,
        })
      } else {
        stack.partTransitions.delete(partId)
        stack.currentPartOpacities.set(partId, 0)
        try {
          setPartOpacityOnCore(coreModel, partId, 0)
        } catch {
          /* ignore */
        }
      }
    }
    for (const partId of stack.shownParts) {
      stack.appliedShownParts.add(partId)
      stack.appliedHiddenParts.delete(partId)
      const fromOp = stack.currentPartOpacities.get(partId) ?? 0
      if (fromOp < 1 - 1e-3) {
        stack.partTransitions.set(partId, {
          from: fromOp,
          to: 1,
          startTime: now,
          duration: transitionMs,
          releaseOnComplete: false,
        })
      } else {
        stack.partTransitions.delete(partId)
        stack.currentPartOpacities.set(partId, 1)
        try {
          setPartOpacityOnCore(coreModel, partId, 1)
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (!stack.coreUpdateWrapped && typeof coreModel.update === 'function') {
    stack.coreUpdateWrapped = true
    const origUpdate = coreModel.update.bind(coreModel)
    coreModel.update = () => {
      origUpdate()
      applyCollapsedVertices(coreModel, stack.collapsedVertices)
    }
  }
  applyCollapsedVertices(coreModel, stack.collapsedVertices)

  const internalModel = (model as any).internalModel

  // 包装 updateFocus：在保留待机动作头身摆动与视线微动（baseVal）的基础上，
  // 按 focusWeight 叠加基于双眼中点原点的鼠标视线偏移（baseVal + targetVal * w）
  if (!stack.focusUpdateWrapped && typeof internalModel?.updateFocus === 'function') {
    stack.focusUpdateWrapped = true
    const origUpdateFocus = internalModel.updateFocus.bind(internalModel)
    internalModel.updateFocus = () => {
      const fc = internalModel.focusController
      const currentCore = internalModel.coreModel
      const w = getEffectiveFocusWeight(stack, nowMs())
      if (
        fc &&
        typeof fc.x === 'number' &&
        typeof fc.y === 'number' &&
        currentCore &&
        typeof currentCore.getParameterValueById === 'function' &&
        typeof currentCore.setParameterValueById === 'function'
      ) {
        const fx = fc.x
        const fy = fc.y
        const addFocusParam = (paramId: string | undefined, targetVal: number) => {
          if (!paramId) return
          try {
            const baseVal = Number(currentCore.getParameterValueById(paramId)) || 0
            currentCore.setParameterValueById(paramId, baseVal + targetVal * w)
          } catch {
            /* ignore */
          }
        }
        addFocusParam(internalModel.idParamEyeBallX ?? 'ParamEyeBallX', fx)
        addFocusParam(internalModel.idParamEyeBallY ?? 'ParamEyeBallY', fy)
        addFocusParam(internalModel.idParamAngleX ?? 'ParamAngleX', fx * 30)
        addFocusParam(internalModel.idParamAngleY ?? 'ParamAngleY', fy * 30)
        addFocusParam(internalModel.idParamAngleZ ?? 'ParamAngleZ', fx * fy * -30)
        addFocusParam(internalModel.idParamBodyAngleX ?? 'ParamBodyAngleX', fx * 10)
      } else {
        origUpdateFocus()
      }
    }
  }

  // 包装 updateNaturalMovements：在 physics.evaluate 之前推进姿态与五官参数插值，
  // 确保头发、刘海、呆毛与服饰物理每帧都能平滑响应预设的头身角度变化，消除物理阶跃抽动
  if (
    !stack.naturalMovementsWrapped &&
    typeof internalModel?.updateNaturalMovements === 'function'
  ) {
    stack.naturalMovementsWrapped = true
    const origNatural = internalModel.updateNaturalMovements.bind(internalModel)
    internalModel.updateNaturalMovements = (dt: number, now: number) => {
      origNatural(dt, now)
      const currentCore = (model as any).internalModel?.coreModel
      if (!currentCore) return
      const frameNow = nowMs()
      stack.lastParamStepFrameNow = frameNow
      stepStackParametersInFrame(currentCore, stack, frameNow)
      if (stack.lipSyncActive || stack.lipSyncValue > 0.001) {
        try {
          currentCore.setParameterValueById(stack.lipSyncParam, stack.lipSyncValue)
        } catch {
          /* ignore */
        }
      }
    }
  }

  // 挂接 beforeModelUpdate：推进部件透明度（在 pose.updateParameters 之后），
  // 若测试环境未经过 updateNaturalMovements，则在此处兜底推进参数插值
  if (!stack.hooked && typeof internalModel?.on === 'function') {
    stack.hooked = true
    internalModel.on('beforeModelUpdate', () => {
      const currentCore = (model as any).internalModel?.coreModel
      if (!currentCore) return
      const frameNow = nowMs()
      if (!stack.naturalMovementsWrapped) {
        stepStackParametersInFrame(currentCore, stack, frameNow)
      } else {
        // 对于物理输出类的直接覆盖参数（如手动微调呆毛角度），在 physics.evaluate 之后再次确保生效
        for (const [id, val] of stack.currentValues.entries()) {
          if (ADDITIVE_MOTION_PARAM_RE.test(id) || EYE_OPEN_PARAM_RE.test(id)) continue
          try {
            currentCore.setParameterValueById(id, val)
          } catch {
            /* ignore */
          }
        }
      }
      if (stack.lipSyncActive || stack.lipSyncValue > 0.001) {
        try {
          currentCore.setParameterValueById(stack.lipSyncParam, stack.lipSyncValue)
        } catch {
          /* ignore */
        }
      }
      stepStackPartsInFrame(currentCore, stack, frameNow)
    })
  }
}

/**
 * 更新模型的实时口型同步参数：
 * 挂入 InternalModel 的 updateNaturalMovements 与 beforeModelUpdate 阶段（在动作轨道与情绪状态栈之后、coreModel.update 之前），
 * 确保 TTS 说话期间张嘴幅度不会被待机动作或表情预设覆盖，说话结束后自动恢复表情/默认口型。
 */
export function setModelLipSync(
  model: DeskpetModel,
  paramId: string,
  value: number,
  active: boolean = value > 0.001,
): void {
  const stack = getModelStack(model)
  const resolvedParam = paramId || 'ParamMouthOpenY'
  const clampedValue = Number.isFinite(value) ? Math.max(0, value) : 0
  const wasActive = stack.lipSyncActive || stack.lipSyncValue > 0.001
  stack.lipSyncParam = resolvedParam
  stack.lipSyncValue = clampedValue
  stack.lipSyncActive = active

  if (!stack.hooked && !stack.naturalMovementsWrapped) {
    syncModelStack(model, 0)
  }

  const coreModel = (model as any).internalModel?.coreModel
  if (!coreModel || typeof coreModel.setParameterValueById !== 'function') return

  if (active || clampedValue > 0.001) {
    try {
      coreModel.setParameterValueById(resolvedParam, clampedValue)
    } catch {
      /* ignore */
    }
  } else if (wasActive) {
    const fallback =
      stack.currentValues.get(resolvedParam) ??
      stack.emotion[resolvedParam] ??
      stack.controls[resolvedParam] ??
      stack.base[resolvedParam] ??
      getCoreDefaultParamValue(coreModel, resolvedParam)
    try {
      coreModel.setParameterValueById(resolvedParam, fallback)
    } catch {
      /* ignore */
    }
  }
}

/** 设置底层常驻参数（如自动去水印、模型初始修正参数），不受情绪切换或控件重置影响。 */
export function setBaseParameters(
  model: DeskpetModel,
  parameters: Record<string, number>,
): void {
  const stack = getModelStack(model)
  stack.base = { ...parameters }
  const coreModel = (model as any).internalModel?.coreModel
  stack.collapsedVertices = coreModel ? detectOffCanvasBaseVertices(coreModel, stack.base) : []
  syncModelStack(model, 0)
}

/** 设置分步序列演出期间是否由关键帧直接主导眼球视线（不受鼠标位置干扰）。 */
export function setSequenceGazeOverride(model: DeskpetModel, active: boolean): void {
  const stack = getModelStack(model)
  stack.sequenceGazeOverride = active
}

/** 设置鼠标视角跟随权重（0 = 完全居中不随鼠标偏转，1 = 100% 正常跟随鼠标），支持与预设同步平滑插值。 */
export function setFocusWeight(
  model: DeskpetModel,
  weight: number,
  options?: ParameterTransitionOptions,
): void {
  const stack = getModelStack(model)
  const target = Math.min(1, Math.max(0, weight))
  const duration = options?.transitionMs ?? 0
  const now = nowMs()
  const from = getEffectiveFocusWeight(stack, now)
  if (duration <= 0 || Math.abs(target - from) <= 1e-3) {
    stack.focusTransition = null
    stack.focusWeight = target
    return
  }
  stack.focusTransition = {
    from,
    to: target,
    startTime: now,
    duration,
    releaseOnComplete: false,
  }
}

/** 一次性原子更新持久控件层参数、隐藏部件集合与强制显示部件集合，避免多次重复触发过渡栈。 */
export function setControlLayer(
  model: DeskpetModel,
  state: {
    parameters: Record<string, number>
    hiddenParts: Iterable<string>
    shownParts: Iterable<string>
  },
  options?: ParameterTransitionOptions,
): void {
  const stack = getModelStack(model)
  stack.controls = { ...state.parameters }
  stack.hiddenParts = new Set(state.hiddenParts)
  stack.shownParts = new Set(state.shownParts)
  syncModelStack(model, options?.transitionMs ?? 0)
}

/** 设置持久控件层参数（服饰、发型、道具、特效开关等），不受情绪 6 秒回退影响。 */
export function setControlParameters(
  model: DeskpetModel,
  parameters: Record<string, number>,
  options?: ParameterTransitionOptions,
): void {
  const stack = getModelStack(model)
  stack.controls = { ...parameters }
  syncModelStack(model, options?.transitionMs ?? 0)
}

/** 设置需要隐藏的部件 ID 集合（底层 hiddenParts ∪ 激活控件的 hiddenParts）。 */
export function setHiddenParts(
  model: DeskpetModel,
  partIds: Iterable<string>,
  options?: ParameterTransitionOptions,
): void {
  const stack = getModelStack(model)
  stack.hiddenParts = new Set(partIds)
  syncModelStack(model, options?.transitionMs ?? 0)
}

/** 设置需要强制显示的部件 ID 集合（如 pose3.json 中默认隐藏的 PartArmB 举手图层）。 */
export function setShownParts(
  model: DeskpetModel,
  partIds: Iterable<string>,
  options?: ParameterTransitionOptions,
): void {
  const stack = getModelStack(model)
  stack.shownParts = new Set(partIds)
  syncModelStack(model, options?.transitionMs ?? 0)
}

/** 设置瞬态情绪层参数（向后兼容旧签名）。释放时自动回落到 controls / base / 模型默认值。 */
export function applyParameters(
  model: DeskpetModel,
  parameters: Record<string, number>,
  options?: ParameterTransitionOptions,
) {
  const stack = getModelStack(model)
  stack.emotion = { ...parameters }
  syncModelStack(model, options?.transitionMs ?? 0, options?.transitionMs === undefined)
}

export function resizeModel(
  model: DeskpetModel,
  cw: number, ch: number,
  zoom: number = 1.0,
  fx?: number, fy?: number,
) {
  const { refW, refH } = getModelMetrics(model)
  const base = Math.min((cw * 0.85) / refW, (ch * 0.85) / refH)
  const newScale = Math.max(0.01, Math.min(30.0, base * zoom))

  if (fx !== undefined && fy !== undefined) {
    const oldScale = model.scale.x
    if (oldScale > 0) {
      const ratio = newScale / oldScale
      model.position.set(
        fx - (fx - model.position.x) * ratio,
        fy - (fy - model.position.y) * ratio,
      )
    }
  }

  model.scale.set(newScale)
}

export function resizeModelFit(
  model: DeskpetModel,
  cw: number, ch: number,
  zoom: number = 1.0,
) {
  const { refW, refH } = getModelMetrics(model)
  const base = Math.min((cw * 0.85) / refW, (ch * 0.85) / refH)
  const newScale = Math.max(0.01, Math.min(30.0, base * zoom))
  model.scale.set(newScale)
  model.position.set(cw / 2, ch / 2)
}

/** 模型「可见轮廓」的包围盒（artboard 坐标系） */
export interface ModelInkBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 轮廓包围盒的缓存有效期：模型随动作形变，定期重算即可（悬停判定只需「大概范围」） */
const INK_BOUNDS_TTL_MS = 250
const inkBoundsCache = new WeakMap<object, { at: number; bounds: ModelInkBounds | null }>()

/**
 * 求模型「实际可见轮廓」的包围盒，用于悬停命中判定。
 *
 * 为什么不用 model.getBounds()：pixi-live2d-display 的 _calculateBounds() 取的是
 * (0,0)-(width,height) 整块画布，而画布四周有大量透明留白，模型又被放大到窗口的 85%，
 * 结果「命中范围」≈ 整个窗口 —— 鼠标划过窗口空白处也会触发悬停淡化。
 *
 * 这里改为遍历所有「可见且有透明度」的 drawable，取其顶点包围盒的并集，
 * 得到贴合角色的近似矩形（约 250ms 缓存一次，开销可忽略）。
 */
export function getModelInkBounds(model: DeskpetModel): ModelInkBounds | null {
  const key = model as unknown as object
  const now = performance.now()
  const cached = inkBoundsCache.get(key)
  if (cached && now - cached.at < INK_BOUNDS_TTL_MS) return cached.bounds

  const bounds = computeModelInkBounds(model)
  inkBoundsCache.set(key, { at: now, bounds })
  return bounds
}

function computeModelInkBounds(model: DeskpetModel): ModelInkBounds | null {
  const internal = (model as unknown as { internalModel?: any }).internalModel
  const core = internal?.coreModel
  if (!internal || !core) return null
  if (typeof core.getDrawableCount !== 'function') return null
  if (typeof internal.getDrawableBounds !== 'function') return null

  let count = 0
  try {
    count = core.getDrawableCount()
  } catch {
    return null
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i < count; i++) {
    try {
      // 不可见的部件（例如被隐藏的配件）不计入轮廓
      if (
        typeof core.getDrawableDynamicFlagIsVisible === 'function' &&
        !core.getDrawableDynamicFlagIsVisible(i)
      ) {
        continue
      }
      // 完全透明的部件同样不计入
      if (typeof core.getDrawableOpacity === 'function' && core.getDrawableOpacity(i) <= 0.01) {
        continue
      }
      const b = internal.getDrawableBounds(i)
      if (!b || !(b.width > 0) || !(b.height > 0)) continue
      if (b.x < minX) minX = b.x
      if (b.y < minY) minY = b.y
      if (b.x + b.width > maxX) maxX = b.x + b.width
      if (b.y + b.height > maxY) maxY = b.y + b.height
    } catch {
      // 单个 drawable 读取失败不影响整体
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }
  if (maxX <= minX || maxY <= minY) return null
  return { minX, minY, maxX, maxY }
}

/**
 * 把 CSS 像素坐标换算到模型 artboard 坐标系。
 * 复用库自身的 toModelPosition（与其内部 hitTest 同一套变换），保证坐标一致。
 */
export function cssPointToModelSpace(
  model: DeskpetModel,
  cssX: number,
  cssY: number,
): { x: number; y: number } | null {
  try {
    const toModelPosition = (model as unknown as {
      toModelPosition?: (p: { x: number; y: number }, out: { x: number; y: number }) => unknown
    }).toModelPosition
    if (typeof toModelPosition !== 'function') return null

    // 画布按 RESOLUTION 倍渲染，世界坐标 = CSS 坐标 × RESOLUTION
    const input = { x: cssX * RESOLUTION, y: cssY * RESOLUTION }
    const out = { x: 0, y: 0 }
    toModelPosition.call(model, input, out)
    if (!Number.isFinite(out.x) || !Number.isFinite(out.y)) return null
    return out
  } catch {
    return null
  }
}

/**
 * 判断 CSS 坐标是否落在模型可见轮廓内（近似矩形）。
 * 返回 null 表示无法判定（核心 API 不可用），调用方应回落到整块画布判定。
 */
export function isCssPointOverModelInk(
  model: DeskpetModel,
  cssX: number,
  cssY: number,
): boolean | null {
  const ink = getModelInkBounds(model)
  if (!ink) return null
  const p = cssPointToModelSpace(model, cssX, cssY)
  if (!p) return null
  return p.x >= ink.minX && p.x <= ink.maxX && p.y >= ink.minY && p.y <= ink.maxY
}
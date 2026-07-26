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

export let modelRefW = 100
export let modelRefH = 100

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

export async function loadLive2DModel(modelPath: string, app: Application): Promise<DeskpetModel> {
  const model = (await Live2DModel.from(modelPath, {
    autoInteract: false,
    autoUpdate: true,
  })) as DeskpetModel
  model.anchor.set(0.5, 0.5)

  const cw = app.view.width / RESOLUTION
  const ch = app.view.height / RESOLUTION
  modelRefW = model.width || 100
  modelRefH = model.height || 100

  const scale = Math.min((cw * 0.85) / modelRefW, (ch * 0.85) / modelRefH)

  model.scale.set(scale)
  model.position.set(cw / 2, ch / 2)
  app.stage.addChild(model)
  return model
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
}

/**
 * 模型真实存在的参数清单。
 *
 * 这是写 adapter 时最关键、也最拿不到的信息：参数 ID 存在 .moc3 二进制里，
 * .cdi3.json 会列出来但不是必需文件（很多模型没有）。所以只能从运行时的
 * core model 里读。注意 setParameterValueById 对不存在的参数是静默写入
 * 幻影槽位，不会报错 —— 所以必须显式对照这份清单校验。
 */
export function getParameterInfos(model: DeskpetModel): ParameterInfo[] {
  const coreModel = (model.internalModel as any)?.coreModel
  if (!coreModel?.getParameterCount) return []

  const ids: string[] = coreModel._parameterIds ?? []
  const count: number = coreModel.getParameterCount()
  const infos: ParameterInfo[] = []
  for (let i = 0; i < count; i++) {
    const id = ids[i]
    if (typeof id !== 'string') continue
    infos.push({
      id,
      min: coreModel.getParameterMinimumValue?.(i) ?? 0,
      max: coreModel.getParameterMaximumValue?.(i) ?? 0,
      default: coreModel.getParameterDefaultValue?.(i) ?? 0,
    })
  }
  return infos
}

export interface ModelCapabilities {
  modelUrl: string
  motionGroups: Record<string, number>
  expressions: string[]
  parameters: ParameterInfo[]
}

/** 汇总模型能力，用来喂给 AI 生成 deskpet-adapter.json。 */
export function describeModel(model: DeskpetModel, modelUrl: string): ModelCapabilities {
  return {
    modelUrl,
    motionGroups: getMotionGroupSizes(model),
    expressions: getExpressionNames(model),
    parameters: getParameterInfos(model),
  }
}

export function playMotion(model: DeskpetModel, name: string, idx = 0) {
  try {
    model.motion(name, idx, MotionPriority.FORCE)
  } catch (err) {
    console.debug(`[Deskpet] Motion not available: ${name}[${idx}]`, err)
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

const touchedParameterIds = new WeakMap<object, Set<string>>()

export function applyParameters(
  model: DeskpetModel,
  parameters: Record<string, number>,
) {
  const coreModel = (model as any).internalModel?.coreModel
  if (!coreModel) return

  const currentIds = new Set(Object.keys(parameters))
  const previousIds = touchedParameterIds.get(model as unknown as object) ?? new Set<string>()

  for (const id of previousIds) {
    if (currentIds.has(id)) continue
    try {
      coreModel.setParameterValueById(id, 0)
    } catch (err) {
      console.debug(`[Deskpet] Parameter not available while resetting: ${id}`, err)
    }
  }

  for (const [id, value] of Object.entries(parameters)) {
    try {
      coreModel.setParameterValueById(id, value)
    } catch (err) {
      console.debug(`[Deskpet] Parameter not available: ${id}`, err)
    }
  }

  touchedParameterIds.set(model as unknown as object, currentIds)
}

export function resizeModel(
  model: DeskpetModel,
  cw: number, ch: number,
  zoom: number = 1.0,
  fx?: number, fy?: number,
) {
  const base = Math.min((cw * 0.85) / modelRefW, (ch * 0.85) / modelRefH)
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
  const base = Math.min((cw * 0.85) / modelRefW, (ch * 0.85) / modelRefH)
  const newScale = Math.max(0.01, Math.min(30.0, base * zoom))
  model.scale.set(newScale)
  model.position.set(cw / 2, ch / 2)
}

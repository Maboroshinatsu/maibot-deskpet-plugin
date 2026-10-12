/**
 * deskpet-adapter.json 校验器
 *
 * 为什么必须有这东西：Cubism 的 setParameterValueById 对不存在的参数
 * 是**静默写入一个幻影槽位**，不报错也没效果；model.motion() 对不存在的组
 * 只是返回 false。也就是说适配写错时的表现是「完全没反应」，
 * 光靠肉眼调试几乎不可能定位。
 *
 * 所以这里把 adapter 里引用的每个参数 / 动作组 / 表情，
 * 都对着模型真实能力核一遍，把问题变成明确的报错。
 */
import type { ModelEmotionAdapter } from './emotion-adapter'
import { DEFAULT_LIP_SYNC } from './emotion-adapter'
import type { ModelCapabilities } from './loader'

export interface AdapterValidationResult {
  errors: string[]
  warnings: string[]
  /** 有实际映射（表情/动作/参数任一）的情绪数量 */
  mappedEmotions: number
  mappedAnimations: number
  mappedControls: number
}

function formatRange(min: number, max: number): string {
  return `[${min}, ${max}]`
}

export function validateAdapter(
  adapter: ModelEmotionAdapter,
  caps: ModelCapabilities,
): AdapterValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const paramById = new Map(caps.parameters.map((p) => [p.id, p]))
  const partIds = new Set((caps.parts ?? []).map((p) => p.id))
  const expressionNames = new Set(caps.expressions)
  const unregisteredNames = new Set((caps.unregisteredExpressions ?? []).map((n) => n.toLowerCase()))
  const groupSizes = caps.motionGroups

  const checkParameters = (where: string, parameters: Record<string, number>) => {
    for (const [id, value] of Object.entries(parameters)) {
      const info = paramById.get(id)
      if (!info) {
        errors.push(`${where}: 参数 "${id}" 在该模型里不存在（写入会被静默丢弃）`)
        continue
      }
      if (value < info.min || value > info.max) {
        warnings.push(
          `${where}: 参数 "${id}" 的值 ${value} 超出模型范围 ${formatRange(info.min, info.max)}，会被钳制`,
        )
      }
    }
  }

  const checkHiddenParts = (where: string, hiddenParts: string[]) => {
    if (partIds.size === 0) return
    for (const partId of hiddenParts) {
      if (!partIds.has(partId)) {
        errors.push(`${where}: 部件 "${partId}" 在该模型里不存在`)
      }
    }
  }

  const checkMotion = (where: string, group: string, index: number) => {
    const size = groupSizes[group]
    if (size === undefined) {
      const available = Object.keys(groupSizes)
      errors.push(
        `${where}: 动作组 "${group}" 不存在` +
          (available.length ? `，可用的组：${available.join(', ')}` : '（该模型没有任何动作组）'),
      )
      return
    }
    if (index < 0 || index >= size) {
      errors.push(`${where}: 动作组 "${group}" 只有 ${size} 条动作，index ${index} 越界`)
    }
  }

  const checkExpression = (where: string, name: string) => {
    if (expressionNames.has(name) || unregisteredNames.has(name.toLowerCase())) return
    if (expressionNames.size === 0 && unregisteredNames.size === 0) {
      errors.push(
        `${where}: 表情 "${name}" 用不了 —— 该模型的 .model3.json 里没有 Expressions 段，且目录下未找到同名 .exp3.json 文件`,
      )
    } else {
      const allKnown = [...expressionNames, ...(caps.unregisteredExpressions ?? [])]
      errors.push(
        `${where}: 表情 "${name}" 不存在，可用的表情：${allKnown.join(', ')}`,
      )
    }
  }

  if (Object.keys(adapter.baseParameters ?? {}).length > 0) {
    checkParameters('baseParameters', adapter.baseParameters)
  }
  if ((adapter.hiddenParts ?? []).length > 0) {
    checkHiddenParts('hiddenParts', adapter.hiddenParts)
  }

  let mappedEmotions = 0
  for (const [emotion, target] of Object.entries(adapter.emotions)) {
    if (!target) continue
    mappedEmotions++
    const where = `emotions.${emotion}`
    if (target.expression) checkExpression(where, target.expression)
    if (target.motion) checkMotion(where, target.motion.group, target.motion.index ?? 0)
    if (target.parameters) checkParameters(where, target.parameters)
  }

  let mappedAnimations = 0
  for (const [animation, target] of Object.entries(adapter.animations)) {
    if (!target) continue
    mappedAnimations++
    checkMotion(`animations.${animation}`, target.motion.group, target.motion.index ?? 0)
  }

  let mappedControls = 0
  for (const [controlId, target] of Object.entries(adapter.controls ?? {})) {
    if (!target) continue
    mappedControls++
    const where = `controls.${controlId}`
    if (target.expression) checkExpression(where, target.expression)
    if (target.parameters) checkParameters(where, target.parameters)
    if (target.hiddenParts) checkHiddenParts(where, target.hiddenParts)
  }

  for (const group of adapter.idleMotions) {
    checkMotion('idleMotions', group, 0)
  }

  // 口型参数：默认值缺失只提醒，自定义值缺失算错误（说明是写错了）
  const mouthParam = adapter.lipSync.mouthOpenParam
  if (!paramById.has(mouthParam)) {
    const message =
      `lipSync.mouthOpenParam: 参数 "${mouthParam}" 在该模型里不存在，口型同步不会有效果`
    if (mouthParam === DEFAULT_LIP_SYNC.mouthOpenParam) {
      warnings.push(`${message}（请在 adapter 里声明该模型真实的张嘴参数）`)
    } else {
      errors.push(message)
    }
  }

  return { errors, warnings, mappedEmotions, mappedAnimations, mappedControls }
}

/** 把校验结果打到控制台，用户/AI 照着改就行。 */
export function reportAdapterValidation(
  result: AdapterValidationResult,
  caps: ModelCapabilities,
  adapterName: string,
): void {
  const { errors, warnings } = result
  const totalControls = caps.controls?.length ?? result.mappedControls
  if (errors.length === 0 && warnings.length === 0) {
    console.info(
      `[Deskpet] Adapter 校验通过：${adapterName}（情绪 ${result.mappedEmotions} 项，动作 ${result.mappedAnimations} 项，控件 ${totalControls} 项）。` +
        `可用 deskpetTestEmotion('happy') / deskpetTestAnimation('wave') / deskpetListControls() 预览效果`,
    )
    return
  }

  console.group(`[Deskpet] Adapter 校验：${adapterName}`)
  for (const error of errors) console.error(`  ✗ ${error}`)
  for (const warning of warnings) console.warn(`  ! ${warning}`)
  console.info(
    `  模型能力：动作组 ${Object.keys(caps.motionGroups).length} 个、` +
      `表情 ${caps.expressions.length} 个、参数 ${caps.parameters.length} 个、控件 ${totalControls} 个`,
  )
  console.info('  运行 deskpetInspectModel() 可导出完整能力清单，交给 AI 重新生成适配')
  console.groupEnd()
}

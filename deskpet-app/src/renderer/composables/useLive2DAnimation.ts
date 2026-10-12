import type { DeskpetModel } from '@/services/live2d/loader'

/**
 * 待机微动作（呼吸 / 眨眼）
 *
 * 注意：pixi-live2d-display 内部已经带了 CubismBreath 和 CubismEyeBlink，
 * 每帧在 internalModel.update() 里跑。以前这里另外开两条 requestAnimationFrame
 * 自己写 ParamBreath / ParamEyeLOpen，结果是：
 *   - 呼吸变成两条不同相位的正弦叠加，看着发抖；
 *   - 手写的眨眼下一帧就被内置眨眼覆盖，等于白写。
 * 所以这里改成「调节内置系统的参数」，不再自己驱动参数。
 */

const BREATH_PARAMS = {
  angleZ: { offset: 0, peak: 1.2, cycle: 5.5345, weight: 0.15 },
  breath: { offset: 0.5, peak: 0.5, cycle: 3.2345, weight: 0.5 },
}

/** 眨眼间隔（秒），比 Cubism 默认的 4 秒稍快一点，显得更有生气 */
const BLINK_INTERVAL_SECONDS = 3.0

export function useLive2DAnimation() {
  function start(model: DeskpetModel) {
    const internalModel = model.internalModel as any
    if (!internalModel) return

    try {
      const breath = internalModel.breath
      if (breath?.setParameters && internalModel.idParamBreath) {
        // 仅驱动呼吸与极轻微自然呼吸摆幅，不向 AngleX/AngleY 注入大幅正弦偏移，确保鼠标对准脸部时模型能稳定正视屏幕
        breath.setParameters([
          ...(internalModel.idParamAngleZ
            ? [{ parameterId: internalModel.idParamAngleZ, ...BREATH_PARAMS.angleZ }]
            : []),
          { parameterId: internalModel.idParamBreath, ...BREATH_PARAMS.breath },
        ])
      }
    } catch (err) {
      console.debug('[Deskpet] Breath tuning unavailable, using library defaults', err)
    }

    try {
      internalModel.eyeBlink?.setBlinkingInterval?.(BLINK_INTERVAL_SECONDS)
    } catch (err) {
      console.debug('[Deskpet] Blink tuning unavailable, using library defaults', err)
    }

    if (!internalModel.eyeBlink) {
      console.info('[Deskpet] Model has no EyeBlink group, auto blink disabled')
    }
  }

  function stop() {
    // 内置系统随 model 一起销毁，这里无需清理
  }

  return { start, stop }
}

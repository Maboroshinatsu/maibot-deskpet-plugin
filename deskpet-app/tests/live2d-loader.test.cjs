'use strict'
// DP-009 / DP-011 / DP-014: loader 的实例尺寸、动作结果、参数复位。全部使用替身，无 WebGL。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/live2d/loader.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

const SIZES = { 'small.model3.json': [100, 100], 'large.model3.json': [400, 800] }

function fakeModel(w, h) {
  return {
    width: w, height: h,
    anchor: { set() {} },
    scale: { x: 1, y: 1, set(sx, sy) { this.x = sx; this.y = sy } },
    position: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y } },
    destroyed: false,
    destroy() { this.destroyed = true },
    motion: async () => true,
    internalModel: { motionManager: null, coreModel: null },
  }
}

function harness() {
  const created = []
  const requireMap = {
    '@pixi/app': { Application: function Application() {} },
    '@pixi/extensions': { extensions: { add() {} } },
    '@pixi/ticker': { Ticker: function Ticker() {}, TickerPlugin: {} },
    'pixi-live2d-display/cubism4': {
      Live2DModel: {
        registerTicker() {},
        from: async (p) => {
          const [w, h] = SIZES[p] || [100, 100]
          const m = fakeModel(w, h)
          m.path = p
          created.push(m)
          return m
        },
      },
      MotionPriority: { FORCE: 3, NORMAL: 2 },
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (n) => requireMap[n],
    window: {}, console,
  })
  return { loader: module.exports, created }
}

test('model metrics are per instance, not a module-level global', async () => {
  const h = harness()
  const small = await h.loader.createLive2DModel('small.model3.json')
  const large = await h.loader.createLive2DModel('large.model3.json')
  // 注意：vm 上下文里的对象原型与宿主不同，逐字段比较而不是 deepStrictEqual
  const metricsOf = (m) => { const x = h.loader.getModelMetrics(m); return [x.refW, x.refH] }
  assert.deepEqual(metricsOf(small), [100, 100])
  assert.deepEqual(metricsOf(large), [400, 800])
  // 未知模型回落默认值，不再读到"上一个模型"的尺寸
  assert.deepEqual(metricsOf({}), [100, 100])
})

test('resize uses the model own metrics', async () => {
  const h = harness()
  const large = await h.loader.createLive2DModel('large.model3.json')
  h.loader.resizeModel(large, 1000, 1000, 1)
  // base = min(850/400, 850/800) = 1.0625
  assert.ok(Math.abs(large.scale.x - 1.0625) < 1e-9, `got ${large.scale.x}`)
  h.loader.resizeModelFit(large, 1000, 1000, 2)
  assert.ok(Math.abs(large.scale.x - 2.125) < 1e-9, `got ${large.scale.x}`)
})

test('createLive2DModel does not touch the visible stage', async () => {
  const h = harness()
  const app = { view: { width: 600, height: 800 }, stage: { children: [], addChild(c) { this.children.push(c) } } }
  const m = await h.loader.createLive2DModel('small.model3.json')
  assert.equal(app.stage.children.length, 0, '准备阶段不得上舞台')
  h.loader.attachLive2DModel(m, app)
  h.loader.attachLive2DModel(m, app)
  assert.equal(app.stage.children.length, 1, '重复提交不应重复挂载')
  assert.ok(m.scale.x > 0)
})

test('discardLive2DModel destroys a prepared model', async () => {
  const h = harness()
  const m = await h.loader.createLive2DModel('small.model3.json')
  h.loader.discardLive2DModel(m)
  assert.equal(m.destroyed, true)
})

test('playMotion reports the library result instead of always succeeding', async () => {
  const h = harness()
  const m = fakeModel(100, 100)
  m.motion = async () => false
  assert.equal(await h.loader.playMotion(m, 'wave', 0), false)
  m.motion = async () => true
  assert.equal(await h.loader.playMotion(m, 'wave', 0), true)
  m.motion = async () => { throw new Error('boom') }
  assert.equal(await h.loader.playMotion(m, 'wave', 0), false)
})

test('onMotionFinish subscribes and unsubscribes safely', async () => {
  const h = harness()
  const listeners = {}
  const manager = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn) },
    off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn) },
  }
  const m = fakeModel(100, 100)
  m.internalModel.motionManager = manager
  let hits = 0
  const off = h.loader.onMotionFinish(m, () => { hits++ })
  assert.equal(listeners.motionFinish.length, 1)
  listeners.motionFinish[0]()
  assert.equal(hits, 1)
  off()
  assert.equal(listeners.motionFinish.length, 0)
  // 没有 motionManager 时是安全的空操作
  const noop = h.loader.onMotionFinish({}, () => {})
  assert.equal(typeof noop, 'function')
  noop()
})

test('applyParameters restores the model default value, not a hard-coded 0', () => {
  const h = harness()
  const core = {
    values: {},
    defaults: { ParamCheek: 0.5, ParamMouthForm: 0.25 },
    setParameterValueById(id, v) { this.values[id] = v },
    getParameterDefaultValueById(id) { return this.defaults[id] ?? 0 },
  }
  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core
  h.loader.applyParameters(m, { ParamCheek: 1, ParamMouthForm: -1 })
  assert.equal(core.values.ParamCheek, 1)
  assert.equal(core.values.ParamMouthForm, -1)
  h.loader.applyParameters(m, {})
  assert.equal(core.values.ParamCheek, 0.5, '非零默认值必须复位到默认而不是 0')
  assert.equal(core.values.ParamMouthForm, 0.25)
})

test('applyParameters falls back to 0 when the core model has no default lookup', () => {
  const h = harness()
  const core = { values: {}, setParameterValueById(id, v) { this.values[id] = v } }
  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core
  h.loader.applyParameters(m, { ParamEyeLSmile: 1 })
  h.loader.applyParameters(m, {})
  assert.equal(core.values.ParamEyeLSmile, 0)
})

test('3-layer stack preserves base watermarks and controls when transient emotions revert', () => {
  const h = harness()
  const core = {
    values: {},
    partOpacities: {},
    defaults: { Paramheadxy: 0, ParamHat: 0, ParamMouthForm: 0 },
    setParameterValueById(id, v) { this.values[id] = v },
    getParameterDefaultValueById(id) { return this.defaults[id] ?? 0 },
    setPartOpacityById(id, v) { this.partOpacities[id] = v },
  }
  const m = fakeModel(100, 100)
  m.internalModel.coreModel = core

  // 1. 底层常驻去水印参数
  h.loader.setBaseParameters(m, { Paramheadxy: 30 })
  assert.equal(core.values.Paramheadxy, 30)

  // 2. 开启持久控件（戴帽子 + 隐藏某部件）
  h.loader.setControlParameters(m, { ParamHat: 1 })
  h.loader.setHiddenParts(m, ['PartCoat'])
  assert.equal(core.values.Paramheadxy, 30)
  assert.equal(core.values.ParamHat, 1)
  assert.equal(core.partOpacities.PartCoat, 0)

  // 3. 触发瞬态情绪，随后 6 秒回退释放情绪参数
  h.loader.applyParameters(m, { ParamMouthForm: 1 })
  assert.equal(core.values.ParamMouthForm, 1)
  h.loader.applyParameters(m, {})
  assert.equal(core.values.ParamMouthForm, 0, '瞬态情绪参数应复位到默认值')
  assert.equal(core.values.Paramheadxy, 30, '去水印底层参数不得被情绪回退冲掉')
  assert.equal(core.values.ParamHat, 1, '已开启的持久控件不得被情绪回退冲掉')

  // 4. 关闭持久控件后复位到默认值，但底层去水印依然保留
  h.loader.setControlParameters(m, {})
  h.loader.setHiddenParts(m, [])
  assert.equal(core.values.ParamHat, 0)
  assert.equal(core.partOpacities.PartCoat, 1)
  assert.equal(core.values.Paramheadxy, 30)
})

test('setBaseParameters collapses vertices pushed off-canvas by watermark parameters while keeping normal vertices', () => {
  const h = harness()
  const m = fakeModel(100, 100)

  // 模拟 RetrynowMiku 的 ArtMesh77：前 1 个顶点 (0.2, 1.0) 是正常脸部，后 1 个顶点在 Watermark=1 时从 (0.0, 1.0) 平移到画布顶边 (1.875) 之外的 (0.0, 2.4)
  const verts = new Float32Array([0.2, 1.0, 0.0, 1.0])
  const rawModel = {
    canvasinfo: { CanvasWidth: 6000, CanvasHeight: 7501, PixelsPerUnit: 2000 },
    parameters: {
      ids: ['Watermark'],
      defaultValues: new Float32Array([0]),
      values: new Float32Array([0]),
    },
    drawables: {
      vertexPositions: [verts],
    },
    update() {
      const wm = this.parameters.values[0]
      verts[0] = 0.2
      verts[1] = 1.0
      verts[2] = 0.0
      verts[3] = wm > 0.5 ? 2.4 : 1.0
    },
  }

  const core = {
    _model: rawModel,
    setParameterValueById(id, val) {
      const idx = rawModel.parameters.ids.indexOf(id)
      if (idx >= 0) rawModel.parameters.values[idx] = val
    },
    getParameterDefaultValueById() {
      return 0
    },
    update() {
      rawModel.update()
    },
  }
  m.internalModel.coreModel = core

  h.loader.setBaseParameters(m, { Watermark: 1 })
  core.update()

  assert.ok(Math.abs(verts[0] - 0.2) < 1e-5, '正常脸部顶点 X 不应受影响')
  assert.ok(Math.abs(verts[1] - 1.0) < 1e-5, '正常脸部顶点 Y 不应受影响')
  assert.equal(verts[2], 0, '被推到画布外的水印顶点 X 应折叠为 0')
  assert.equal(verts[3], 0, '被推到画布外的水印顶点 Y 应折叠为 0')
})

test('transition release updates _savedParameters so loadParameters does not revert SchoolUniform back to 1', async () => {
  const h = harness()
  const m = fakeModel(100, 100)
  const hooks = {}
  m.internalModel.on = (ev, fn) => {
    hooks[ev] = fn
  }

  const rawParams = {
    ids: ['SchoolUniform'],
    defaultValues: [0],
    values: [0],
  }
  const core = {
    _model: { parameters: rawParams },
    _savedParameters: [0],
    setParameterValueById(id, val) {
      const idx = rawParams.ids.indexOf(id)
      if (idx >= 0) rawParams.values[idx] = val
    },
    getParameterValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.values[idx] : 0
    },
    getParameterDefaultValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.defaultValues[idx] : 0
    },
    saveParameters() {
      this._savedParameters[0] = rawParams.values[0]
    },
    loadParameters() {
      rawParams.values[0] = this._savedParameters[0]
    },
  }
  m.internalModel.coreModel = core

  function simulateCubismFrame() {
    core.saveParameters()
    if (hooks.beforeModelUpdate) hooks.beforeModelUpdate()
    const renderedVal = rawParams.values[0]
    core.loadParameters()
    return renderedVal
  }

  // 1) 激活带 SchoolUniform=1 的预设，并跑一帧让 _savedParameters 固化为 1
  h.loader.setControlParameters(m, { SchoolUniform: 1 }, { transitionMs: 20 })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(simulateCubismFrame(), 1)
  assert.equal(core._savedParameters[0], 1)

  // 2) 切换到不含 SchoolUniform 的预设（transitionMs: 20）
  h.loader.setControlParameters(m, {}, { transitionMs: 20 })
  const midVal = simulateCubismFrame()
  assert.ok(midVal > 0 && midVal <= 1, '过渡期间应平滑插值')

  // 3) 等待过渡动画结束，再跑多帧验证绝不会跳回 1
  await new Promise((r) => setTimeout(r, 35))
  const endVal1 = simulateCubismFrame()
  const endVal2 = simulateCubismFrame()
  assert.equal(endVal1, 0, '过渡结束帧应为默认值 0')
  assert.equal(endVal2, 0, '过渡结束后的后续帧不得被 loadParameters 还原回 1')
})

test('additive posture parameters and eye-open scaling preserve continuous motion curves and blinking', () => {
  const h = harness()
  const m = fakeModel(100, 100)
  const hooks = {}
  m.internalModel.on = (ev, fn) => {
    hooks[ev] = fn
  }

  const rawParams = {
    ids: ['ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeBallX'],
    defaultValues: [0, 1, 0],
    values: [0, 1, 0],
  }
  const partOpacities = new Map()
  const core = {
    _model: { parameters: rawParams },
    _savedParameters: [0, 1, 0],
    setParameterValueById(id, val) {
      const idx = rawParams.ids.indexOf(id)
      if (idx >= 0) rawParams.values[idx] = val
    },
    getParameterValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.values[idx] : 0
    },
    getParameterDefaultValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.defaultValues[idx] : 0
    },
    setPartOpacityById(partId, op) {
      partOpacities.set(partId, op)
    },
  }
  m.internalModel.coreModel = core

  // 设定歪头偏移 ParamAngleZ = -10、半眯眼 ParamEyeLOpen = 0.4、视线左飘 ParamEyeBallX = -0.8，并强制显示 PartArmB
  h.loader.setControlParameters(m, { ParamAngleZ: -10, ParamEyeLOpen: 0.4, ParamEyeBallX: -0.8 })
  h.loader.setShownParts(m, ['PartArmB'])

  // 模拟第 1 帧：动作曲线输出 ParamAngleZ = +6，眨眼处于睁眼状态 ParamEyeLOpen = 1.0，待机随机视线输出 +0.5
  rawParams.values[0] = 6
  rawParams.values[1] = 1.0
  rawParams.values[2] = 0.5
  hooks.beforeModelUpdate()
  assert.ok(Math.abs(rawParams.values[0] - -4) < 1e-5, '歪头预设应与动作曲线叠加 (6 + -10 = -4)')
  assert.ok(Math.abs(rawParams.values[1] - 0.4) < 1e-5, '半眯眼在睁眼帧应保持 0.4')
  assert.ok(Math.abs(rawParams.values[2] - -0.8) < 1e-5, '预设眼球视线由关键帧直接驱动 (-0.8)，不受待机随机斜视 (+0.5) 干扰')
  assert.equal(partOpacities.get('PartArmB'), 1, 'setShownParts 应将 PartArmB 透明度设为 1')

  // 模拟第 2 帧：眨眼器触发闭眼 (ParamEyeLOpen = 0)
  rawParams.values[0] = 3
  rawParams.values[1] = 0
  rawParams.values[2] = 0.5
  hooks.beforeModelUpdate()
  assert.ok(Math.abs(rawParams.values[0] - -7) < 1e-5, '歪头预设继续跟随动作曲线摆动 (3 + -10 = -7)')
  assert.equal(rawParams.values[1], 0, '半眯眼在眨眼闭眼帧仍能自然完全闭合到 0')
  assert.ok(Math.abs(rawParams.values[2] - -0.8) < 1e-5, '眼球视线持续保持预设目标 (-0.8)')
})

test('setModelLipSync overrides motion and emotion mouth openness in beforeModelUpdate and restores when speaking ends', () => {
  const h = harness()
  const m = fakeModel(100, 100)
  const hooks = {}
  m.internalModel.on = (ev, fn) => {
    hooks[ev] = fn
  }

  const rawParams = {
    ids: ['ParamMouthOpenY'],
    defaultValues: [0],
    values: [0],
  }
  const core = {
    _model: { parameters: rawParams },
    _savedParameters: [0],
    setParameterValueById(id, val) {
      const idx = rawParams.ids.indexOf(id)
      if (idx >= 0) rawParams.values[idx] = val
    },
    getParameterValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.values[idx] : 0
    },
    getParameterDefaultValueById(id) {
      const idx = rawParams.ids.indexOf(id)
      return idx >= 0 ? rawParams.defaultValues[idx] : 0
    },
  }
  m.internalModel.coreModel = core

  // 当前处于带张嘴的情绪（如 surprise: ParamMouthOpenY = 0.8）
  h.loader.applyParameters(m, { ParamMouthOpenY: 0.8 })
  assert.ok(Math.abs(rawParams.values[0] - 0.8) < 1e-5)

  // TTS 开始播报：句中某字音张嘴 0.45，即使待机动作把曲线刷成 0、情绪栈想写成 0.8，beforeModelUpdate 后也应为 0.45
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0.45, true)
  rawParams.values[0] = 0 // 模拟 motionManager.update 覆盖为 0
  hooks.beforeModelUpdate()
  assert.ok(Math.abs(rawParams.values[0] - 0.45) < 1e-5, '说话期间口型应覆盖待机动作与情绪栈')

  // TTS 句中停顿：speakingActive 仍为 true，但音量为 0，嘴应闭合到 0 而不是跳回 surprise 的 0.8
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0, true)
  rawParams.values[0] = 0
  hooks.beforeModelUpdate()
  assert.equal(rawParams.values[0], 0, '句间停顿应保持闭嘴 0')

  // TTS 播放结束：speakingActive = false，口型释放回当前激活情绪的 0.8
  h.loader.setModelLipSync(m, 'ParamMouthOpenY', 0, false)
  assert.ok(Math.abs(rawParams.values[0] - 0.8) < 1e-5, '说话结束后应恢复当前情绪的张嘴值')
})

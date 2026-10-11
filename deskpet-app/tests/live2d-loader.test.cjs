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

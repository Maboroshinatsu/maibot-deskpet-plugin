'use strict'
// DP-009: 动作层级与循环。使用替身模型与替身 loader，无 WebGL、无真实动作文件。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/composables/useMotionPriority.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const flush = () => new Promise((resolve) => setImmediate(resolve))

function harness() {
  const state = { playResult: true }
  const calls = { play: [] }
  const finishes = []
  const timers = []
  const requireMap = {
    '@/stores/deskpet': {},
    '@/services/live2d/loader': {
      playMotion: async (_model, name, idx) => {
        calls.play.push([name, idx])
        return state.playResult
      },
      onMotionFinish: (_model, handler) => {
        const entry = { handler, active: true }
        finishes.push(entry)
        return () => { entry.active = false }
      },
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (n) => requireMap[n],
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: () => {},
  })
  const store = { live2dModel: null }
  return {
    api: module.exports.useMotionPriority(store),
    layers: module.exports.MotionLayer,
    store, calls, finishes, timers, state,
  }
}

test('no model means nothing is played', () => {
  const h = harness()
  assert.equal(h.api.playMotionWithPriority('wave', h.layers.Reply), false)
  assert.equal(h.calls.play.length, 0)
})

test('a lower layer cannot interrupt a higher one', () => {
  const h = harness()
  h.store.live2dModel = {}
  assert.equal(h.api.playMotionWithPriority('wave', h.layers.Interaction), true)
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), false)
  assert.deepEqual(h.calls.play, [['wave', 0]])
})

test('loop: subscribes to motionFinish and replays when the motion ends', async () => {
  const h = harness()
  h.store.live2dModel = {}
  assert.equal(h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true }), true)
  await flush()
  assert.equal(h.api.isLooping(), true)
  assert.equal(h.finishes.length, 1)
  h.finishes[0].handler()
  await flush()
  assert.deepEqual(h.calls.play, [['dance', 0], ['dance', 0]])
})

test('stopLoop halts an active loop', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  h.api.stopLoop()
  assert.equal(h.api.isLooping(), false)
  h.finishes[0].handler()
  await flush()
  assert.equal(h.calls.play.length, 1, '停止后不得再续播')
})

test('a new play takes over the loop ownership from the previous one', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  const first = h.finishes[0]
  h.api.playMotionWithPriority('wave', h.layers.Interaction)
  await flush()
  first.handler()
  await flush()
  assert.deepEqual(h.calls.play, [['dance', 0], ['wave', 0]], '旧循环不得续播')
})

test('a non-loop play never registers a loop handler', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('wave', h.layers.Reply)
  await flush()
  assert.equal(h.finishes.length, 0)
  assert.equal(h.api.isLooping(), false)
})

test('unsupported motion releases the layer instead of blocking it', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.state.playResult = false
  h.api.playMotionWithPriority('missing', h.layers.Reply, 0, { loop: true })
  await flush()
  assert.equal(h.api.isLooping(), false)
  assert.equal(h.finishes.length, 0)
  // 层级已释放：低优先级动作仍可播放
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), true)
})

test('reset stops the loop and clears the layer', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  h.api.reset()
  assert.equal(h.api.isLooping(), false)
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), true)
})

test('switching the model stops the previous loop from replaying', async () => {
  const h = harness()
  const first = {}
  h.store.live2dModel = first
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  const handler = h.finishes[0].handler
  h.store.live2dModel = {}   // 换模型
  handler()
  await flush()
  assert.equal(h.calls.play.length, 1, '换模型后旧循环不得续播')
})

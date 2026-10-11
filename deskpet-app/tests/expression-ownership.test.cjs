'use strict'
// DP-014: 情绪回退归属。只验证"谁负责调度回退"，不涉及音频。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/composables/useExpressionState.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

function harness() {
  const watchers = []
  const timers = []
  const cleared = []
  const requireMap = {
    vue: { watch: (_source, cb) => { watchers.push(cb) } },
    '@/stores/deskpet': {},
    '@/services/live2d/loader': {
      applyParameters() {}, clearExpression() {}, setExpression() {},
    },
    '@/services/live2d/emotion-adapter': { getEmotionTarget: () => null },
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (n) => requireMap[n],
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id },
    clearTimeout: (id) => { cleared.push(id) },
  })
  return { use: module.exports.useExpressionState, watchers, timers, cleared }
}

function storeFor(extra) {
  return Object.assign({
    live2dModel: null, currentEmotion: 'neutral', emotionPulse: 0,
    defaultEmotion: 'neutral', emotionAdapter: null,
  }, extra)
}

test('image-set mode never schedules a revert timer (StaticStage owns it)', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: null, currentEmotion: 'happy' }))
  assert.equal(h.watchers.length, 1)
  h.watchers[0](['happy'])
  assert.equal(h.timers.length, 0, '立绘包模式下不应由本控制器回退')
})

test('live2d mode schedules exactly one revert for a transient emotion', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: {}, currentEmotion: 'happy' }))
  h.watchers[0](['happy'])
  assert.equal(h.timers.length, 1)
})

test('repeated pulses refresh the window instead of stacking timers', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: {}, currentEmotion: 'happy' }))
  h.watchers[0](['happy'])
  h.watchers[0](['happy'])
  assert.equal(h.timers.length, 2, '每次触发建一个新定时器')
  assert.equal(h.cleared.length, 1, '但旧的一定被清掉，不会叠加')
})

test('default and neutral emotions do not schedule a revert', () => {
  const h = harness()
  h.use(storeFor({ live2dModel: {}, currentEmotion: 'neutral', defaultEmotion: 'neutral' }))
  h.watchers[0](['neutral'])
  assert.equal(h.timers.length, 0)
  h.watchers[0](['idle'])
  assert.equal(h.timers.length, 0)
})

test('cleanup clears the pending revert timer', () => {
  const h = harness()
  const api = h.use(storeFor({ live2dModel: {}, currentEmotion: 'happy' }))
  h.watchers[0](['happy'])
  api.cleanup()
  assert.equal(h.cleared.length, 1)
})

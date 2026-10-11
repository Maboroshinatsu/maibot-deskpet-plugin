'use strict'
// DP-013: 换图探针时序，纯逻辑，无 DOM / 图片 / 网络。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/imageset/probe-guard.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
function guard() {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports })
  return module.exports.createProbeGuard()
}

test('A -> slow B -> A: the stale B probe can no longer commit', () => {
  const g = guard()
  const tokenB = g.next()          // 请求 B
  const tokenA = g.next()          // 目标又变回 A（当前图）
  assert.equal(g.isCurrent(tokenB), false, 'B 必须被作废')
  assert.equal(g.isCurrent(tokenA), true)
})

test('only the newest probe is current', () => {
  const g = guard()
  const a = g.next()
  const b = g.next()
  const c = g.next()
  assert.equal(g.isCurrent(a), false)
  assert.equal(g.isCurrent(b), false)
  assert.equal(g.isCurrent(c), true)
})

test('invalidate cancels every in-flight probe (unmount / pack switch)', () => {
  const g = guard()
  const t = g.next()
  g.invalidate()
  assert.equal(g.isCurrent(t), false)
})

test('repeat of the same target still invalidates earlier probes', () => {
  const g = guard()
  const first = g.next()
  const second = g.next()
  assert.equal(g.isCurrent(first), false)
  assert.equal(g.isCurrent(second), true)
})

test('a fresh guard starts with no valid probe', () => {
  const g = guard()
  assert.equal(g.isCurrent(0), true)
  assert.equal(g.isCurrent(1), false)
})

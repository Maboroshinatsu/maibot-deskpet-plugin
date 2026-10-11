'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/main/runtime-approval.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function harness() {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports })
  const state = { candidate: { id: '1', pythonPath: 'C:\\MaiBot\\python.exe', sourceUrl: 'ws://127.0.0.1:8523/ws' }, trusted: true, result: false }
  const prompts = [], approved = []
  const options = {
    isTrustedSender: () => state.trusted,
    getCandidate: () => state.candidate,
    approve: id => { approved.push(id); return true },
    confirm: async candidate => { prompts.push(candidate); return state.result },
  }
  return { state, prompts, approved, options, create: () => module.exports.createRuntimeApproval(options) }
}
test('untrusted sender, invalid ID and absent candidate never prompt or approve', async () => {
  const h = harness(), run = h.create()
  h.state.trusted = false
  assert.equal(await run({}, '1'), false)
  h.state.trusted = true
  assert.equal(await run({}, 1), false)
  assert.equal(await run({}, 'old'), false)
  h.state.candidate = null
  assert.equal(await run({}, '1'), false)
  assert.equal(h.prompts.length, 0)
  assert.equal(h.approved.length, 0)
})
test('native cancellation never grants permission', async () => {
  const h = harness()
  assert.equal(await h.create()({}, '1'), false)
  assert.equal(h.prompts.length, 1)
  assert.equal(h.approved.length, 0)
})
test('matching candidate is approved only after positive confirmation', async () => {
  const h = harness(); h.state.result = true
  assert.equal(await h.create()({}, '1'), true)
  assert.deepEqual(h.approved, ['1'])
})
for (const change of ['disconnect', 'replace', 'path', 'source', 'sender']) {
  test(`in-flight native confirmation invalidated by ${change}`, async () => {
    const h = harness()
    let resolve
    h.options.confirm = () => new Promise(yes => { resolve = yes })
    const run = h.create()
    const pending = run({}, '1')
    assert.equal(await run({}, '1'), false)
    if (change === 'disconnect') h.state.candidate = null
    if (change === 'replace') h.state.candidate = { ...h.state.candidate, id: '2' }
    if (change === 'path') h.state.candidate.pythonPath = 'C:\\other\\python.exe'
    if (change === 'source') h.state.candidate.sourceUrl = 'ws://localhost:9999/ws'
    if (change === 'sender') h.state.trusted = false
    resolve(true)
    assert.equal(await pending, false)
    assert.deepEqual(h.approved, [])
  })
}
test('dialog failure releases single-flight guard for a subsequent request', async () => {
  const h = harness()
  h.options.confirm = async () => { throw new Error('dialog unavailable') }
  const run = h.create()
  await assert.rejects(run({}, '1'), /dialog unavailable/)
  h.options.confirm = async () => true
  assert.equal(await run({}, '1'), true)
})

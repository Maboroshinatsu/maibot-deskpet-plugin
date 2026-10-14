'use strict'
// DP-017 相关：端侧语音合成的串行队列。纯逻辑，无 Vue / DOM / Electron。
// 回归点：并发合成会让短句抢在长句前面入队，导致语音顺序与消息顺序不一致。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/services/serial-task-queue.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

function createQueue(onError) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports })
  return module.exports.createSerialTaskQueue(onError)
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('slow first task still completes before a fast second task (voice order preserved)', async () => {
  const q = createQueue()
  const done = []
  q.push(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    done.push('slow-first')
  })
  q.push(() => {
    done.push('fast-second')
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.deepEqual(done, ['slow-first', 'fast-second'])
})

test('three short replies keep arrival order', async () => {
  const q = createQueue()
  const done = []
  const delays = [20, 5, 1]
  delays.forEach((ms, i) => {
    q.push(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      done.push(i)
    })
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.deepEqual(done, [0, 1, 2])
})

test('a failing task does not block the tasks behind it', async () => {
  const errors = []
  const q = createQueue((err) => errors.push(err))
  const done = []
  q.push(() => {
    throw new Error('boom')
  })
  q.push(() => {
    done.push('after-error')
  })
  await tick()
  await tick()
  assert.deepEqual(done, ['after-error'])
  assert.equal(errors.length, 1)
  assert.equal(errors[0].message, 'boom')
})

test('invalidate drops a batch queued before it, but later pushes still run', async () => {
  const q = createQueue()
  const done = []
  q.push(() => done.push('old-a'))
  q.push(() => done.push('old-b'))
  q.invalidate()
  q.push(() => done.push('new'))
  await tick()
  await tick()
  assert.deepEqual(done, ['new'])
})

test('invalidate during an await makes the late result stale', async () => {
  const q = createQueue()
  const delivered = []
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let started = false
  q.push(async (isStale) => {
    started = true
    await gate
    if (isStale()) return
    delivered.push('stale-result')
  })
  await tick()
  assert.equal(started, true)
  q.invalidate()
  release()
  await tick()
  await tick()
  assert.deepEqual(delivered, [])
})
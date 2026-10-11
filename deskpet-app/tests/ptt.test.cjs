'use strict'

// Real TypeScript controller, fake audio only: no Vue, browser, microphone or bridge.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../src/renderer/composables/usePttInput.ts')
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: sourcePath,
}).outputText
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness({ mode = 'ptt', vad = false, recording = false } = {}) {
  const calls = { start: 0, stop: 0, cancel: 0 }
  const texts = [], errors = [], starts = [], stops = []
  const state = { mode, vad, recording }
  let audioGeneration = 0
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) { throw new Error(`unexpected controller dependency: ${name}`) },
  }, { filename: sourcePath })
  assert.equal(typeof module.exports.createPttController, 'function')
  const controller = module.exports.createPttController({
    async start() {
      calls.start++
      const generation = audioGeneration
      const acquired = starts.length ? await starts.shift()() : true
      // Matches the audio layer contract: cancel invalidates late permission streams.
      if (acquired && generation === audioGeneration) state.recording = true
      return acquired
    },
    async stop() {
      calls.stop++
      state.recording = false
      return stops.length ? await stops.shift()() : 'recognized text'
    },
    cancel() {
      calls.cancel++
      audioGeneration++
      state.recording = false
    },
    isRecording: () => state.recording,
    isVadEnabled: () => state.vad,
    getMode: () => state.mode,
    onText: text => texts.push(text),
    onError: error => errors.push(error),
  })
  return { controller, calls, texts, errors, state, starts, stops }
}

async function finish(h) {
  if (h.state.mode === 'toggle') return h.controller.onDown()
  return h.controller.onUp()
}

async function successfulCycle(h) {
  await h.controller.onDown()
  if (h.state.mode === 'toggle') await h.controller.onUp()
  await finish(h)
  await h.controller.onUp()
}

const options = { timeout: 3000 }

test('ptt sends only on release; repeated down/up events do not duplicate work', options, async () => {
  const h = harness()
  await h.controller.onUp()
  assert.deepEqual(h.calls, { start: 0, stop: 0, cancel: 0 })
  await h.controller.onDown()
  await h.controller.onDown()
  assert.equal(h.calls.start, 1)
  assert.equal(h.state.recording, true)
  assert.equal(h.calls.stop, 0)
  assert.deepEqual(h.texts, [])
  await h.controller.onUp()
  await h.controller.onUp()
  assert.equal(h.calls.stop, 1)
  assert.equal(h.calls.cancel, 0)
  assert.deepEqual(h.texts, ['recognized text'])
  assert.deepEqual(h.errors, [])
})

test('toggle requires a second distinct down; up and held-key repeats never stop', options, async () => {
  const h = harness({ mode: 'toggle' })
  await h.controller.onDown()
  await h.controller.onDown()
  assert.equal(h.calls.start, 1)
  assert.equal(h.calls.stop, 0)
  await h.controller.onUp()
  assert.equal(h.state.recording, true)
  assert.deepEqual(h.texts, [])
  await h.controller.onDown()
  await h.controller.onDown()
  await h.controller.onUp()
  assert.equal(h.calls.stop, 1)
  assert.equal(h.calls.cancel, 0)
  assert.deepEqual(h.texts, ['recognized text'])
  assert.deepEqual(h.errors, [])
})

for (const mode of ['ptt', 'toggle']) {
  for (const blockedBy of ['vad', 'recording']) {
    test(`${mode}: ${blockedBy} blocks acquisition and cancel preserves external audio`, options, async () => {
      const h = harness({ mode, [blockedBy]: true })
      await h.controller.onDown()
      await h.controller.onUp()
      h.controller.cancel()
      assert.deepEqual(h.calls, { start: 0, stop: 0, cancel: 0 })
      assert.equal(h.state[blockedBy], true)
      assert.deepEqual(h.texts, [])
      assert.deepEqual(h.errors, [])
      h.state[blockedBy] = false
      await successfulCycle(h)
      assert.deepEqual(h.texts, ['recognized text'])
    })
  }

  test(`${mode}: start(false) does not grant ownership or stop/cancel external audio`, options, async () => {
    const h = harness({ mode })
    h.starts.push(async () => { h.state.recording = true; return false })
    await h.controller.onDown()
    await h.controller.onUp()
    h.controller.cancel()
    assert.deepEqual(h.calls, { start: 1, stop: 0, cancel: 0 })
    assert.equal(h.state.recording, true)
    assert.deepEqual(h.texts, [])
    assert.deepEqual(h.errors, [])
    h.state.recording = false
    await successfulCycle(h)
    assert.deepEqual(h.texts, ['recognized text'])
  })

  test(`${mode}: deferred permission ignores repeated down without duplicate start`, options, async () => {
    const h = harness({ mode }), gate = deferred()
    h.starts.push(() => gate.promise)
    const pending = h.controller.onDown()
    await flush()
    await h.controller.onDown()
    assert.equal(h.calls.start, 1)
    assert.equal(h.calls.stop, 0)
    gate.resolve(true)
    await pending
    if (mode === 'toggle') await h.controller.onUp()
    await finish(h)
    assert.equal(h.calls.stop, 1)
    assert.deepEqual(h.texts, ['recognized text'])
  })

  test(`${mode}: service cancellation discards owned recording and allows recovery`, options, async () => {
    const h = harness({ mode })
    await h.controller.onDown()
    h.controller.cancel()
    assert.equal(h.calls.cancel, 1)
    assert.equal(h.calls.stop, 0)
    assert.equal(h.state.recording, false)
    h.controller.cancel()
    await h.controller.onUp()
    assert.equal(h.calls.cancel, 1)
    assert.deepEqual(h.texts, [])
    await successfulCycle(h)
    assert.deepEqual(h.texts, ['recognized text'])
  })

  for (const cancelled of [false, true]) {
    test(`${mode}: pending transcription blocks start${cancelled ? ' and cancel suppresses late text' : ''}`, options, async () => {
      const h = harness({ mode }), gate = deferred()
      h.stops.push(() => gate.promise)
      await h.controller.onDown()
      if (mode === 'toggle') await h.controller.onUp()
      const pending = finish(h)
      await flush()
      assert.equal(h.calls.stop, 1)
      assert.equal(h.state.recording, false)
      if (cancelled) h.controller.cancel()
      await h.controller.onUp()
      await h.controller.onDown()
      await h.controller.onDown()
      await h.controller.onUp()
      assert.equal(h.calls.start, 1, 'busy transcription must not acquire another recording')
      assert.equal(h.calls.stop, 1)
      assert.deepEqual(h.texts, [])
      gate.resolve('late transcript')
      await pending
      assert.deepEqual(h.texts, cancelled ? [] : ['late transcript'])
      assert.deepEqual(h.errors, [])
      await successfulCycle(h)
      assert.equal(h.calls.start, 2)
      assert.equal(h.calls.stop, 2)
      assert.deepEqual(h.texts, cancelled ? ['recognized text'] : ['late transcript', 'recognized text'])
    })
  }

  test(`${mode}: cancellation during transcription preserves a new manual recording`, options, async () => {
    const h = harness({ mode }), gate = deferred()
    h.stops.push(() => gate.promise)
    await h.controller.onDown()
    if (mode === 'toggle') await h.controller.onUp()
    const pending = finish(h)
    await flush()
    h.state.recording = true // A user starts manual audio after PTT has stopped.
    h.controller.cancel()
    assert.equal(h.calls.cancel, 0)
    assert.equal(h.calls.stop, 1)
    assert.equal(h.state.recording, true)
    gate.resolve('discard this text')
    await pending
    await h.controller.onUp()
    assert.deepEqual(h.texts, [])
    assert.equal(h.state.recording, true)
    assert.deepEqual(h.errors, [])
  })

  for (const operation of ['start', 'stop']) {
    test(`${mode}: ${operation} rejection is reported once and releases busy state`, options, async () => {
      const h = harness({ mode }), gate = deferred(), error = new Error(`${operation} failed`)
      h[operation === 'start' ? 'starts' : 'stops'].push(() => gate.promise)
      let pending
      if (operation === 'start') pending = h.controller.onDown()
      else {
        await h.controller.onDown()
        if (mode === 'toggle') await h.controller.onUp()
        pending = finish(h)
      }
      await flush()
      gate.reject(error)
      await pending
      await h.controller.onUp()
      assert.equal(h.errors.length, 1)
      assert.equal(h.errors[0], error, 'preserve original error, do not swallow it')
      assert.deepEqual(h.texts, [])
      await successfulCycle(h)
      assert.deepEqual(h.texts, ['recognized text'])
      assert.equal(h.errors.length, 1)
    })
  }
}

for (const action of ['release', 'cancel']) {
  test(`ptt: ${action} during permission wait invalidates late start and sends nothing`, options, async () => {
    const h = harness(), gate = deferred()
    h.starts.push(() => gate.promise)
    const pending = h.controller.onDown()
    await flush()
    if (action === 'release') await h.controller.onUp()
    else h.controller.cancel()
    assert.equal(h.calls.stop, 0)
    assert.ok(h.calls.cancel >= 1, 'pending audio acquisition must be cancelled')
    gate.resolve(true)
    await pending
    await h.controller.onUp()
    assert.equal(h.state.recording, false)
    assert.equal(h.calls.stop, 0)
    assert.deepEqual(h.texts, [])
    assert.deepEqual(h.errors, [])
    await successfulCycle(h)
    assert.deepEqual(h.texts, ['recognized text'])
  })
}

test('toggle: release during permission wait does not cancel; second press stops', options, async () => {
  const h = harness({ mode: 'toggle' }), gate = deferred()
  h.starts.push(() => gate.promise)
  const pending = h.controller.onDown()
  await flush()
  await h.controller.onUp()
  assert.deepEqual(h.calls, { start: 1, stop: 0, cancel: 0 })
  gate.resolve(true)
  await pending
  assert.equal(h.state.recording, true)
  await h.controller.onDown()
  await h.controller.onUp()
  assert.deepEqual(h.texts, ['recognized text'])
})

test('null transcription is not sent and the next recording still works', options, async () => {
  const h = harness()
  h.stops.push(async () => null)
  await successfulCycle(h)
  assert.deepEqual(h.texts, [])
  assert.deepEqual(h.errors, [])
  await successfulCycle(h)
  assert.deepEqual(h.texts, ['recognized text'])
})

test('idle cancel never stops a manual recording', options, async () => {
  const h = harness({ recording: true })
  h.controller.cancel()
  await h.controller.onUp()
  assert.deepEqual(h.calls, { start: 0, stop: 0, cancel: 0 })
  assert.equal(h.state.recording, true)
  assert.deepEqual(h.texts, [])
})

'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function load(file, globals) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, ...globals })
  return module.exports
}
function setup(options = {}) {
  const permission = deferred(), transcription = deferred()
  const recorders = [], tracks = [], vadStreams = []
  const state = { mode: options.mode || 'ptt' }
  function newStream() {
    const track = { readyState: 'live', stop() { this.readyState = 'ended' } }
    tracks.push(track)
    return { getTracks: () => [track] }
  }
  const stream = newStream()
  let mediaCalls = 0, sttCalls = 0
  class Recorder {
    constructor() { this.state = 'inactive'; recorders.push(this) }
    start() { this.state = 'recording' }
    stop() {
      assert.equal(this.state, 'recording')
      this.state = 'inactive'
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(['fake-audio']) })
        void this.onstop()
      })
    }
  }
  class AudioContext {
    async decodeAudioData() { return { getChannelData: () => new Float32Array([0]), sampleRate: 16000 } }
    close() {}
  }
  const imports = {
    vue: { ref: value => ({ value }), readonly: value => value },
    './useVad': { useVad: () => ({
      start: async (_callbacks, stream) => { vadStreams.push(stream); if (options.failVad) throw new Error('VAD start failed') },
      stop() {}, setThreshold() {}, setSilenceTimeout() {},
    }) },
    '@/stores/deskpet': { useDeskpetStore: () => ({ isSpeaking: false }) },
  }
  const { useVoiceInput } = load('../src/renderer/composables/useVoiceInput.ts', {
    require: name => { assert.ok(Object.hasOwn(imports, name)); return imports[name] },
    navigator: { mediaDevices: { getUserMedia() { mediaCalls++; return mediaCalls === 1 ? permission.promise : Promise.resolve(newStream()) } } },
    window: { electronAPI: { sttTranscribe() { sttCalls++; return transcription.promise } } },
    localStorage: { getItem: () => null }, console, MediaRecorder: Recorder, AudioContext, Blob,
  })
  const { createPttController } = load('../src/renderer/composables/usePttInput.ts', {})
  const voice = useVoiceInput()
  const sent = [], errors = []
  const channel = voice.createRecordingChannel()
  const ptt = createPttController({
    start: channel.start, stop: channel.stop, cancel: channel.cancel, hasCapture: channel.hasCapture,
    isRecording: () => voice.recordingActive.value, isVadEnabled: () => voice.vadActive.value,
    getMode: () => state.mode, onText: text => sent.push(text), onError: error => errors.push(error),
  })
  return { voice, ptt, channel, state, vadStreams, sent, errors, stream, tracks, recorders, permission, transcription,
    mediaCalls: () => mediaCalls, sttCalls: () => sttCalls }
}

test('cancel while acquiring microphone discards late grant and stops tracks', async () => {
  const h = setup()
  const pending = h.voice.start()
  h.voice.cancel()
  h.permission.resolve(h.stream)
  assert.equal(await pending, false)
  assert.equal(h.recorders.length, 0)
  assert.equal(h.tracks[0].readyState, 'ended')
})

test('concurrent start claims only one recorder', async () => {
  const h = setup()
  const first = h.voice.start()
  assert.equal(await h.voice.start(), false)
  h.permission.resolve(h.stream)
  assert.equal(await first, true)
  assert.equal(h.mediaCalls(), 1)
  assert.equal(h.recorders.length, 1)
  h.voice.cancel()
  await flush()
  assert.equal(h.tracks[0].readyState, 'ended')
})

test('active cancellation does not transcribe or send recorded audio', async () => {
  const h = setup()
  h.permission.resolve(h.stream)
  await h.voice.start()
  h.voice.cancel()
  await flush()
  assert.equal(h.sttCalls(), 0)
  assert.equal(h.voice.recordingActive.value, false)
  assert.equal(h.tracks[0].readyState, 'ended')
})

test('cancel invalidates in-flight transcription result', async () => {
  const h = setup()
  h.permission.resolve(h.stream)
  await h.voice.start()
  const result = h.voice.stop()
  await flush()
  assert.equal(h.sttCalls(), 1)
  h.voice.cancel()
  h.transcription.resolve('must not send')
  assert.equal(await result, null)
})

test('cleanup during permission prompt leaves no live microphone', async () => {
  const h = setup()
  const pending = h.voice.start()
  h.voice.cleanup()
  h.permission.resolve(h.stream)
  assert.equal(await pending, false)
  assert.equal(h.tracks[0].readyState, 'ended')
})

test('PTT early release propagates cancellation through real voice controller', async () => {
  const h = setup()
  const down = h.ptt.onDown()
  await h.ptt.onUp()
  h.permission.resolve(h.stream)
  await down
  assert.equal(h.recorders.length, 0)
  assert.equal(h.tracks[0].readyState, 'ended')
  assert.deepEqual(h.sent, [])
})

test('PTT bridge cancellation stops owned capture without submitting half audio', async () => {
  const h = setup()
  h.permission.resolve(h.stream)
  await h.ptt.onDown()
  assert.equal(h.voice.recordingActive.value, true)
  h.ptt.cancel()
  await flush()
  assert.equal(h.voice.recordingActive.value, false)
  assert.equal(h.sttCalls(), 0)
  assert.deepEqual(h.sent, [])
})

test('normal PTT release still transcribes and sends exactly once', async () => {
  const h = setup()
  h.permission.resolve(h.stream)
  await h.ptt.onDown()
  const up = h.ptt.onUp()
  await flush()
  h.transcription.resolve('normal speech')
  await up
  assert.deepEqual(h.sent, ['normal speech'])
  assert.equal(h.sttCalls(), 1)
})


for (const action of ['cancel', 'down']) {
  test(`old toggle PTT ${action} cannot stop a replacement manual recording`, async () => {
    const h = setup({ mode: 'toggle' })
    h.permission.resolve(h.stream)
    await h.ptt.onDown()
    await h.ptt.onUp()
    const externalStop = h.voice.stop()
    await flush()
    h.transcription.resolve('externally stopped PTT')
    await externalStop
    assert.equal(await h.voice.start(), true)
    assert.equal(h.recorders[1].state, 'recording')
    if (action === 'cancel') h.ptt.cancel()
    else await h.ptt.onDown()
    await flush()
    assert.equal(h.recorders[1].state, 'recording')
    assert.equal(h.voice.recordingActive.value, true)
    assert.deepEqual(h.sent, [])
    h.voice.cleanup()
  })
}

test('owner cancellation does not invalidate another owner transcription', async () => {
  const h = setup()
  h.permission.resolve(h.stream)
  await h.voice.start()
  const manualText = h.voice.stop()
  await flush()
  await h.channel.start()
  h.channel.cancel()
  h.transcription.resolve('manual result remains valid')
  assert.equal(await manualText, 'manual result remains valid')
  await flush()
})

test('cancelled PTT preserves the shared stream leased by pending VAD', async () => {
  const h = setup()
  const down = h.ptt.onDown()
  const vad = h.voice.enableVad(() => {})
  h.ptt.cancel()
  h.permission.resolve(h.stream)
  await Promise.all([down, vad])
  assert.equal(h.mediaCalls(), 1)
  assert.equal(h.recorders.length, 0)
  assert.equal(h.voice.vadActive.value, true)
  assert.equal(h.vadStreams[0].getTracks()[0].readyState, 'live')
  assert.deepEqual(h.sent, [])
  h.voice.disableVad()
  assert.equal(h.tracks[0].readyState, 'ended')
})

test('all cancelled consumers release the late shared stream', async () => {
  const h = setup()
  const down = h.ptt.onDown()
  const vad = h.voice.enableVad(() => {})
  h.ptt.cancel()
  h.voice.disableVad()
  h.permission.resolve(h.stream)
  await Promise.all([down, vad])
  assert.equal(h.vadStreams.length, 0)
  assert.equal(h.recorders.length, 0)
  assert.equal(h.voice.vadActive.value, false)
  assert.equal(h.tracks[0].readyState, 'ended')
})

test('VAD start failure releases its pending lease and microphone', async () => {
  const h = setup({ failVad: true })
  const pending = h.voice.enableVad(() => {})
  h.permission.resolve(h.stream)
  await assert.rejects(pending, /VAD start failed/)
  assert.equal(h.voice.vadActive.value, false)
  assert.equal(h.tracks[0].readyState, 'ended')
})

test('disableVad never cancels a manual capture', async () => {
  const h = setup()
  h.permission.resolve(h.stream)
  await h.voice.start()
  h.voice.disableVad()
  assert.equal(h.voice.recordingActive.value, true)
  assert.equal(h.recorders[0].state, 'recording')
  h.voice.cleanup()
})

test('cleanup forbids fresh capture and VAD acquisition', async () => {
  const h = setup()
  h.voice.cleanup()
  assert.equal(await h.voice.start(), false)
  await h.voice.enableVad(() => {})
  assert.equal(h.mediaCalls(), 0)
})

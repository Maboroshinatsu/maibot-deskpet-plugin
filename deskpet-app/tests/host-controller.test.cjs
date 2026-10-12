'use strict'
// DP-017：事件控制器。用纯对象替身验证行为，无 Vue/Pinia/Electron/DOM。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadHostModule } = require('./helpers/host-loader.cjs')
const { applyHostEvent } = loadHostModule('event-controller')

function deps(overrides = {}) {
  const calls = []
  const base = {
    isKnownEmotion: () => true,
    setEmotion: (e) => calls.push(['setEmotion', e]),
    playAnimation: (n, l) => calls.push(['playAnimation', n, l]),
    appendReplyDelta: (d, r) => calls.push(['appendReplyDelta', d, r]),
    finishReply: (r, e) => calls.push(['finishReply', r, e]),
    showReplyText: (t) => calls.push(['showReplyText', t]),
    playAudio: (b) => calls.push(['playAudio', b]),
    addEmoji: (b, d) => calls.push(['addEmoji', b, d]),
    setThinking: (a) => calls.push(['setThinking', a]),
    offerRuntimeCandidate: (p) => calls.push(['offerRuntimeCandidate', p]),
    log: (...a) => calls.push(['log', ...a]),
    warn: (...a) => calls.push(['warn', ...a]),
    debug: (...a) => calls.push(['debug', ...a]),
    ...overrides,
  }
  return { deps: base, calls }
}

test('reply-delta clears thinking then appends', () => {
  const h = deps()
  assert.equal(applyHostEvent({ kind: 'reply-delta', delta: 'hi', requestId: 'r' }, h.deps), true)
  assert.deepEqual(h.calls, [['setThinking', false], ['appendReplyDelta', 'hi', 'r']])
})

test('reply-done finishes and warns only when error present', () => {
  const ok = deps()
  applyHostEvent({ kind: 'reply-done', requestId: 'r' }, ok.deps)
  assert.deepEqual(ok.calls, [['setThinking', false], ['finishReply', 'r', undefined]])
  const bad = deps()
  applyHostEvent({ kind: 'reply-done', requestId: 'r', error: 'x' }, bad.deps)
  assert.deepEqual(bad.calls[2], ['warn', '[Deskpet] Reply failed:', 'x'])
})

test('unknown emotion is rejected and logged, not applied', () => {
  const h = deps({ isKnownEmotion: () => false })
  applyHostEvent({ kind: 'emotion', emotion: 'nope' }, h.deps)
  assert.equal(h.calls.some((c) => c[0] === 'setEmotion'), false)
  assert.deepEqual(h.calls[0], ['debug', '[Deskpet] Ignore unknown emotion:', 'nope'])
})

test('known emotion is applied', () => {
  const h = deps()
  applyHostEvent({ kind: 'emotion', emotion: 'happy' }, h.deps)
  assert.deepEqual(h.calls, [['setEmotion', 'happy']])
})

test('empty audio and empty emoji are ignored', () => {
  const h = deps()
  applyHostEvent({ kind: 'audio', base64: '' }, h.deps)
  applyHostEvent({ kind: 'emoji', base64: '', description: 'x' }, h.deps)
  assert.equal(h.calls.some((c) => c[0] === 'playAudio'), false)
  assert.equal(h.calls.some((c) => c[0] === 'addEmoji'), false)
  assert.ok(h.calls.some((c) => c[0] === 'setThinking' && c[1] === false))
})

test('empty runtime candidate is not offered to the platform layer', () => {
  const h = deps()
  applyHostEvent({ kind: 'runtime-candidate', python: '', sourceUrl: '' }, h.deps)
  assert.equal(h.calls.some((c) => c[0] === 'offerRuntimeCandidate'), false)
  const h2 = deps()
  applyHostEvent({ kind: 'runtime-candidate', python: 'C:\\Py\\python.exe', sourceUrl: '' }, h2.deps)
  assert.deepEqual(h2.calls, [['offerRuntimeCandidate', 'C:\\Py\\python.exe']])
})

test('connection, heartbeat and unknown produce no UI side effects', () => {
  const h = deps()
  assert.equal(applyHostEvent({ kind: 'connection', state: 'connected' }, h.deps), false)
  assert.equal(applyHostEvent({ kind: 'heartbeat' }, h.deps), false)
  assert.equal(applyHostEvent({ kind: 'unknown', type: 'x', data: {} }, h.deps), false)
  assert.deepEqual(h.calls, [['log', '[Deskpet] Unknown message type:', 'x', {}]])
})

test('animation forwards name and loop', () => {
  const h = deps()
  applyHostEvent({ kind: 'animation', name: 'wave', loop: true }, h.deps)
  assert.deepEqual(h.calls, [['playAnimation', 'wave', true]])
})

test('control event forwards control name and action when setControl is provided', () => {
  const calls = []
  const h = deps({ setControl: (c, a) => calls.push([c, a]) })
  assert.equal(applyHostEvent({ kind: 'control', control: '戴帽子', action: 'on' }, h.deps), true)
  assert.deepEqual(calls, [['戴帽子', 'on']])
})

test('control event with action=set and emotion applies multi-control combination and emotion in one request', () => {
  const controlCalls = []
  const h = deps({ setControl: (c, a) => controlCalls.push([c, a]) })
  assert.equal(
    applyHostEvent({ kind: 'control', control: '脸红,爱心眼', action: 'set', emotion: 'shy' }, h.deps),
    true,
  )
  assert.deepEqual(controlCalls, [['脸红,爱心眼', 'set']])
  assert.deepEqual(h.calls, [['setEmotion', 'shy']])
})

test('emotion event with controls applies emotion and transient control combination together', () => {
  const controlCalls = []
  const h = deps({ setControl: (c, a) => controlCalls.push([c, a]) })
  assert.equal(
    applyHostEvent({ kind: 'emotion', emotion: 'happy', controls: '星星眼,棒棒糖' }, h.deps),
    true,
  )
  assert.deepEqual(h.calls, [['setEmotion', 'happy']])
  assert.deepEqual(controlCalls, [['星星眼,棒棒糖', 'set']])
})

test('control event with action=preset does not call setEmotion to overwrite preset with neutral', () => {
  const controlCalls = []
  const h = deps({ setControl: (c, a) => controlCalls.push([c, a]) })
  assert.equal(
    applyHostEvent({ kind: 'control', control: '厌烦', action: 'preset', emotion: 'neutral' }, h.deps),
    true,
  )
  assert.deepEqual(controlCalls, [['厌烦', 'preset']])
  assert.deepEqual(h.calls, [])
})


'use strict'
// DP-017 验收：FakeHost 在无 WebSocket / MaiBot / Python / Electron 的情况下驱动前端事件处理。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadHostModule } = require('./helpers/host-loader.cjs')

const { createFakeHost } = loadHostModule('fake-host')
const { applyHostEvent } = loadHostModule('event-controller')
const { NO_CAPABILITIES } = loadHostModule('contracts')
const plain = (v) => JSON.parse(JSON.stringify(v))

test('FakeHost drives the event pipeline end to end without any real host', () => {
  const host = createFakeHost({ capabilities: { statusEvents: true, assistantText: true, sendInput: true } })
  const applied = []
  const deps = {
    isKnownEmotion: () => true,
    setEmotion: (e) => applied.push(['emotion', e]),
    playAnimation: (n, l) => applied.push(['animation', n, l]),
    appendReplyDelta: (d, r) => applied.push(['delta', d, r]),
    finishReply: (r) => applied.push(['done', r]),
    showReplyText: (t) => applied.push(['text', t]),
    playAudio: (b) => applied.push(['audio', b]),
    addEmoji: (b, d) => applied.push(['emoji', b, d]),
    setThinking: (a) => applied.push(['thinking', a]),
    offerRuntimeCandidate: (p) => applied.push(['runtime', p]),
    log: () => {}, warn: () => {}, debug: () => {},
  }
  host.subscribe((ev) => applyHostEvent(ev, deps))
  host.connect()

  host.emit({ kind: 'thinking', active: true })
  host.emit({ kind: 'reply-delta', delta: '你好', requestId: 'r1' })
  host.emit({ kind: 'reply-done', requestId: 'r1' })
  host.emit({ kind: 'emotion', emotion: 'happy' })
  host.emit({ kind: 'animation', name: 'wave', loop: false })
  host.emit({ kind: 'audio', base64: 'AAA' })
  host.emit({ kind: 'emoji', base64: 'B', description: '贴贴' })
  host.emit({ kind: 'runtime-candidate', python: 'C:\\Py\\python.exe', sourceUrl: '' })

  assert.deepEqual(applied, [
    ['thinking', true],
    ['thinking', false], ['delta', '你好', 'r1'],
    ['thinking', false], ['done', 'r1'],
    ['emotion', 'happy'],
    ['animation', 'wave', false],
    ['audio', 'AAA'],
    ['thinking', false], ['emoji', 'B', '贴贴'],
    ['runtime', 'C:\\Py\\python.exe'],
  ])
  assert.equal(host.getConnectionState(), 'connected')
})

test('reverse commands are recorded and gated by declared capabilities', () => {
  const full = createFakeHost({ capabilities: { sendInput: true } })
  assert.equal(full.sendUserText('hi'), true)
  assert.equal(full.sendScreenshot('AAA'), true)
  assert.equal(full.sendModelEmotions(['happy']), true)
  // vm 上下文数组原型不同，JSON 归一化后比较
  assert.deepEqual(plain(full.record.userText), ['hi'])
  assert.deepEqual(plain(full.record.screenshots), ['AAA'])
  assert.deepEqual(plain(full.record.modelEmotions), [['happy']])

  // 未声明 sendInput 时必须返回 false，而不是静默丢弃
  const limited = createFakeHost()
  assert.equal(limited.getCapabilities().sendInput, false)
  assert.equal(limited.sendUserText('hi'), false)
  assert.deepEqual(plain(limited.record.userText), [])
})

test('unsubscribe stops delivery and dispose clears listeners', () => {
  const host = createFakeHost()
  let hits = 0
  const off = host.subscribe(() => { hits++ })
  host.emit({ kind: 'thinking', active: true })
  assert.equal(hits, 1)
  off()
  host.emit({ kind: 'thinking', active: true })
  assert.equal(hits, 1)

  host.subscribe(() => { hits++ })
  host.dispose()
  host.emit({ kind: 'thinking', active: true })
  assert.equal(hits, 1)
  assert.equal(host.getConnectionState(), 'disconnected')
})

test('default capabilities are all false (no implied support)', () => {
  const host = createFakeHost()
  assert.deepEqual({ ...host.getCapabilities() }, { ...NO_CAPABILITIES })
})

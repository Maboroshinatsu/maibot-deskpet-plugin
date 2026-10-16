'use strict'
// DP-017：MaiBot 协议归一化。纯函数，无 Vue/Pinia/Electron/DOM。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadHostModule } = require('./helpers/host-loader.cjs')
const { normalizeServerMessage } = loadHostModule('maibot-protocol')

const n = (type, data = {}, extra = {}) => normalizeServerMessage({ type, data, ...extra })
// vm 上下文对象原型与宿主不同，统一 JSON 归一化后再比较
const plain = (v) => (v === null ? null : JSON.parse(JSON.stringify(v)))
const same = (actual, expected) => assert.deepStrictEqual(plain(actual), expected)

test('text delta carries delta and request id', () => {
  same(n('output:text:delta', { delta: '你好' }, { request_id: 'r1' }),
    { kind: 'reply-delta', delta: '你好', requestId: 'r1' })
  same(n('output:text:delta', { delta: 'x', request_id: 'r2' }),
    { kind: 'reply-delta', delta: 'x', requestId: 'r2' })
})

test('reply done omits error when absent and keeps it when present', () => {
  same(n('output:text:done', {}, { request_id: 'r1' }),
    { kind: 'reply-done', requestId: 'r1' })
  same(n('output:text:done', { error: 'boom' }, { request_id: 'r2' }),
    { kind: 'reply-done', requestId: 'r2', error: 'boom' })
  same(n('output:text:done', { text: '你好', speak: true, tts_style: '欢快活泼' }, { request_id: 'r3' }),
    { kind: 'reply-done', requestId: 'r3', text: '你好', speak: true, style: '欢快活泼' })
})

test('full text, emotion, animation, audio, thinking, emoji map correctly', () => {
  same(n('output:text', { text: 'hi' }), { kind: 'reply-text', text: 'hi' })
  same(n('state:emotion', { emotion: 'happy' }), { kind: 'emotion', emotion: 'happy' })
  same(n('state:animation', { name: 'wave', loop: true }),
    { kind: 'animation', name: 'wave', loop: true })
  same(n('state:animation', { name: 'wave' }),
    { kind: 'animation', name: 'wave', loop: false })
  same(n('state:control', { control: '戴帽子', action: 'on' }),
    { kind: 'control', control: '戴帽子', action: 'on' })
  same(n('state:control', { control: '戴帽子' }),
    { kind: 'control', control: '戴帽子', action: 'toggle' })
  same(n('output:audio', { base64: 'AAA' }), { kind: 'audio', base64: 'AAA' })
  same(n('state:thinking', {}), { kind: 'thinking', active: true })
  same(n('output:emoji', { base64: 'B', description: '贴贴' }),
    { kind: 'emoji', base64: 'B', description: '贴贴' })
})

test('sys:env becomes a runtime candidate and never carries frame-supplied source', () => {
  const ev = n('sys:env', { python: 'C:\\Py\\python.exe', sourceUrl: 'ws://attacker/ws' })
  same(ev, { kind: 'runtime-candidate', python: 'C:\\Py\\python.exe', sourceUrl: '' })
})

test('sys:env carries botName when present', () => {
  const ev = n('sys:env', { python: 'C:\\Py\\python.exe', bot_name: 'Airi' })
  same(ev, { kind: 'runtime-candidate', python: 'C:\\Py\\python.exe', sourceUrl: '', botName: 'Airi' })
})

test('heartbeat produces no event (handled by link liveness)', () => {
  assert.equal(n('heartbeat'), null)
})

test('unknown type is preserved as data, not executed', () => {
  same(n('weird:thing', { a: 1 }), { kind: 'unknown', type: 'weird:thing', data: { a: 1 } })
})

test('malformed payloads degrade to empty strings instead of throwing', () => {
  same(n('output:text:delta', { delta: 42 }), { kind: 'reply-delta', delta: '', requestId: '' })
  same(n('state:emotion', null), { kind: 'emotion', emotion: '' })
  same(n('output:audio', {}), { kind: 'audio', base64: '' })
})

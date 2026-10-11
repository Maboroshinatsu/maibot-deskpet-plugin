'use strict'
// Transport trust tests only: no Audio, microphone, VAD, or hotkey operations.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/composables/useWebSocket.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function harness(configuredUrl = 'ws://127.0.0.1:8523/ws') {
  const sockets = [], offers = [], timers = new Map()
  let id = 0, cleared = 0, mount
  const store = { modelEmotions: [], wsConnected: false }
  class Socket {
    static OPEN = 1
    static CONNECTING = 0
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this) }
    send() {}
    close() { this.readyState = 3 }
    open() { this.readyState = 1; this.onopen() }
    message(data) { this.onmessage({ data: JSON.stringify(data) }) }
  }
  const dependencies = {
    vue: { ref: value => ({ value }), onMounted: fn => { mount = fn }, onUnmounted() {} },
    '@/stores/deskpet': { useDeskpetStore: () => store },
    '@/stores/chat': { useChatStore: () => ({}) },
    './useLipSync': { useLipSync: () => ({ start() {}, stop() {} }) },
    '@/services/live2d/emotion-adapter': { isDeskpetEmotionValue: () => false },
    '@/services/protocol': { DEFAULT_WS_URL: 'ws://127.0.0.1:8523/ws' },
    // DP-017：这两条边界现在由 useWebSocket 调用；加载真实实现而不是打桩
    '@/services/host/maibot-protocol': require('./helpers/host-loader.cjs').loadHostModule('maibot-protocol'),
    '@/services/host/event-controller': require('./helpers/host-loader.cjs').loadHostModule('event-controller'),
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name] },
    console: { log() {}, warn() {}, debug() {} }, WebSocket: Socket,
    localStorage: { getItem: key => key === 'deskpet/ws-url' ? configuredUrl : null },
    window: { electronAPI: {
      setDetectedPython: async (...args) => { offers.push(args) },
      clearDetectedPython: async () => { cleared++ },
    } },
    setTimeout(fn) { timers.set(++id, fn); return id }, clearTimeout(id) { timers.delete(id) },
    setInterval(fn) { timers.set(++id, fn); return id }, clearInterval(id) { timers.delete(id) },
  })
  const transport = module.exports.useWebSocket()
  mount()
  return { transport, sockets, store, offers, cleared: () => cleared }
}
test('runtime candidate source comes from configured socket, not message payload', () => {
  const h = harness('ws://localhost:8523/ws?token=test')
  h.sockets[0].open()
  h.sockets[0].message({ type: 'sys:env', data: { python: 'C:\\MaiBot\\python.exe', sourceUrl: 'ws://attacker/ws' } })
  assert.deepEqual(h.offers, [['C:\\MaiBot\\python.exe', 'ws://localhost:8523/ws?token=test']])
})
test('remote source is preserved for main-process rejection rather than disguised as local', () => {
  const h = harness('wss://remote.example/ws')
  h.sockets[0].open()
  h.sockets[0].message({ type: 'sys:env', data: { python: 'C:\\Py\\python.exe', sourceUrl: 'ws://localhost/ws' } })
  assert.equal(h.offers[0][1], 'wss://remote.example/ws')
})
test('current connection close revokes candidate/grant and resets connection state', () => {
  const h = harness(); h.sockets[0].open(); h.sockets[0].onclose()
  assert.equal(h.cleared(), 1)
  assert.equal(h.store.wsConnected, false)
})
test('disconnect revokes runtime immediately before socket close event', () => {
  const h = harness(); h.sockets[0].open(); h.transport.disconnect()
  assert.equal(h.cleared(), 1)
  assert.equal(h.sockets[0].readyState, 3)
})
test('retired socket cannot revoke or offer runtime for replacement connection', () => {
  const h = harness(); const old = h.sockets[0]
  old.open(); h.transport.disconnect(); h.transport.connect()
  const current = h.sockets[1]; current.open()
  const clearedBefore = h.cleared()
  old.onclose()
  old.message({ type: 'sys:env', data: { python: 'C:\\old\\python.exe' } })
  old.onerror()
  assert.equal(h.cleared(), clearedBefore)
  assert.equal(h.offers.length, 0)
  assert.equal(h.store.wsConnected, true)
  assert.equal(current.readyState, 1)
})
test('non-string runtime payload is never offered', () => {
  const h = harness(); h.sockets[0].open()
  for (const python of [null, 42, {}, '']) h.sockets[0].message({ type: 'sys:env', data: { python } })
  assert.equal(h.offers.length, 0)
})

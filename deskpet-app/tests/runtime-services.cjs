'use strict'
// Explicit Windows integration suite. Uses real child processes and loopback TCP,
// but only test-owned Node fixtures; never launches STT/TTS/GSV or a keyboard hook.
const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const vm = require('node:vm')
const cp = require('node:child_process')
const ts = require('typescript')
if (process.platform !== 'win32') throw new Error('This suite validates Windows taskkill behavior')
const root = path.resolve(__dirname, '..')
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/services.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const allChildren = [], liveChildren = new Set(), listeners = new Set(), timeline = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, label, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`)
    await sleep(25)
  }
}
async function listener() {
  const server = net.createServer(socket => socket.end())
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  listeners.add(server)
  return server
}
async function closeServer(server) {
  if (server.listening) await new Promise(resolve => server.close(resolve))
  listeners.delete(server)
}
async function freePort() { const server = await listener(); const port = server.address().port; await closeServer(server); return port }
function isLive(proc) { return proc.exitCode === null && proc.signalCode === null && liveChildren.has(proc) }
function ownedTarget(command, args) {
  assert.equal(command, 'taskkill')
  assert.deepEqual([...args].filter(value => value !== args[1]), ['/pid', '/T', '/F'])
  const proc = [...liveChildren].find(proc => String(proc.pid) === args[1] && isLive(proc))
  if (!proc) throw new Error('Refusing termination: no live ChildProcess owned by this test')
  return proc
}
function fixture(id, port) {
  const code = id === 'hotkey'
    ? "process.stdout.write('PTT_DOWN\\n');setTimeout(()=>process.stdout.write('PTT_UP\\n'),60);setInterval(()=>{},1000)"
    : `const net=require('node:net');net.createServer(s=>s.end()).listen(${port},'127.0.0.1',()=>console.log('READY'));`
  return { id, name: `Runtime fixture ${id}`, port,
    resolve: () => ({ command: process.execPath, args: ['-e', code], cwd: root }) }
}
function harness(t, defs) {
  const events = [], children = [], spawnOptions = []
  const childProcess = {
    spawn(command, args, options) {
      assert.equal(command, process.execPath)
      assert.equal(options.windowsHide, true)
      const proc = cp.spawn(command, args, options)
      allChildren.push(proc); children.push(proc); liveChildren.add(proc); spawnOptions.push(options)
      timeline.push({ type: 'spawn', pid: proc.pid })
      proc.once('exit', (code, signal) => { liveChildren.delete(proc); timeline.push({ type: 'exit', pid: proc.pid, code, signal }) })
      proc.once('error', () => { if (!proc.pid) liveChildren.delete(proc) })
      return proc
    },
    execFile(command, args, options, callback) {
      assert.equal(options.windowsHide, true)
      try { ownedTarget(command, args) } catch (error) { queueMicrotask(() => callback(error)); return }
      return cp.execFile(command, [...args], options, callback)
    },
    execFileSync(command, args, options) {
      assert.equal(options.windowsHide, true)
      ownedTarget(command, args)
      return cp.execFileSync(command, [...args], options)
    },
  }
  const initialConfig = { showTerminal: { hotkey: true }, autoStart: {} }
  const dependencies = {
    './runtime-policy': { validateDetectedPython: () => ({ ok: false, reason: 'No runtime approval in lifecycle fixture' }) },
    child_process: childProcess, net, path,
    fs: { readFileSync: () => JSON.stringify(initialConfig), writeFileSync() {}, mkdirSync() {},
      existsSync: fs.existsSync, statSync: fs.statSync },
    electron: { app: { getPath: () => __dirname, getAppPath: () => root, isPackaged: false } },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name] },
    process: { pid: process.pid, env: { ...process.env } }, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
  }, { filename: path.join(root, 'src/main/services.ts') })
  const manager = new module.exports.ServiceManager((channel, payload) => events.push({ channel, payload }))
  manager.defs = () => defs
  t.after(async () => {
    manager.stopAllSync()
    await until(() => children.every(proc => !isLive(proc)), 'test-owned children to exit')
  })
  return { manager, children, events, spawnOptions, state: id => manager.list().find(item => item.id === id),
    ready: id => until(() => manager.logsOf(id).includes('READY'), `${id} fixture ready`) }
}

after(async () => {
  for (const server of [...listeners]) await closeServer(server)
  // Fallback cleanup uses only live objects created in this invocation, never a saved PID list.
  for (const proc of [...liveChildren]) {
    if (isLive(proc)) proc.kill()
  }
  await until(() => liveChildren.size === 0, 'final owned process cleanup')
  const evidence = { spawned: allChildren.map(proc => proc.pid), remaining: [...liveChildren].map(proc => proc.pid), openListeners: listeners.size, timeline }
  console.log('RUNTIME_CLEANUP_EVIDENCE ' + JSON.stringify(evidence))
  assert.equal(listeners.size, 0)
})

const options = { timeout: 20000, concurrency: false }
test('real occupied port is preserved without spawning a service', options, async t => {
  const server = await listener()
  t.after(() => closeServer(server))
  const h = harness(t, [fixture('stt-bridge', server.address().port)])
  await h.manager.start('stt-bridge')
  assert.equal(h.children.length, 0)
  assert.equal(h.state('stt-bridge').status, 'error')
  assert.equal(server.listening, true)
})

test('ten starts produce one live TCP fixture; stop ends only that child', options, async t => {
  const h = harness(t, [fixture('stt-bridge', await freePort())])
  await Promise.all(Array.from({ length: 10 }, () => h.manager.start('stt-bridge')))
  await h.ready('stt-bridge')
  assert.equal(h.children.length, 1)
  assert.equal(isLive(h.children[0]), true)
  await until(() => h.state('stt-bridge').status === 'running', 'health probe running')
  h.manager.stop('stt-bridge')
  await until(() => !isLive(h.children[0]), 'stop exit')
  assert.equal(h.state('stt-bridge').pid, null)
  assert.equal(h.state('stt-bridge').status, 'stopped')
})

test('restart creates replacement only after original process exit', options, async t => {
  const h = harness(t, [fixture('tts-bridge', await freePort())])
  await h.manager.start('tts-bridge'); await h.ready('tts-bridge')
  const first = h.children[0]
  h.manager.restart('tts-bridge')
  await until(() => h.children.length === 2, 'replacement spawn')
  assert.equal(isLive(first), false)
  const exitedAt = timeline.findIndex(item => item.type === 'exit' && item.pid === first.pid)
  const spawnedAt = timeline.findIndex(item => item.type === 'spawn' && item.pid === h.children[1].pid)
  assert.ok(exitedAt >= 0 && spawnedAt > exitedAt)
  await until(() => h.state('tts-bridge').status === 'running', 'replacement ready')
})

test('repeated restart requests produce one replacement', options, async t => {
  const h = harness(t, [fixture('gpt-sovits', await freePort())])
  await h.manager.start('gpt-sovits'); await h.ready('gpt-sovits')
  h.manager.restart('gpt-sovits'); h.manager.restart('gpt-sovits'); h.manager.restart('gpt-sovits')
  await until(() => h.children.length === 2, 'one replacement')
  await until(() => h.state('gpt-sovits').status === 'running', 'replacement health check')
  assert.equal(h.children.length, 2)
})

test('stopAllSync terminates owned fixtures and prevents restart', options, async t => {
  const h = harness(t, [fixture('stt-bridge', await freePort()), fixture('cloud-tts', await freePort())])
  await Promise.all([h.manager.start('stt-bridge'), h.manager.start('cloud-tts')])
  await Promise.all([h.ready('stt-bridge'), h.ready('cloud-tts')])
  h.manager.stopAllSync()
  await until(() => h.children.every(proc => !isLive(proc)), 'all owned fixtures exit')
  await h.manager.start('stt-bridge')
  assert.equal(h.children.length, 2)
  assert.equal(h.manager.processes.size, 0)
})

test('hotkey fixture keeps stdout despite legacy terminal=true and emits cancel on stop', options, async t => {
  const h = harness(t, [fixture('hotkey', 0)])
  await h.manager.start('hotkey')
  await until(() => h.events.some(event => event.channel === 'ptt-event' && event.payload === 'up'), 'real stdout down/up')
  assert.equal(h.manager.getConfig().showTerminal.hotkey, false)
  assert.deepEqual([...h.spawnOptions[0].stdio], ['ignore', 'pipe', 'pipe'])
  h.manager.stop('hotkey')
  await until(() => !isLive(h.children[0]), 'hotkey fixture exit')
  assert.deepEqual(h.events.filter(event => event.channel === 'ptt-event').map(event => event.payload), ['down', 'up', 'cancel'])
})

test('stop during pending start creates no child', options, async t => {
  const h = harness(t, [fixture('stt-bridge', await freePort())])
  const pending = h.manager.start('stt-bridge')
  h.manager.stop('stt-bridge')
  await pending
  assert.equal(h.children.length, 0)
})

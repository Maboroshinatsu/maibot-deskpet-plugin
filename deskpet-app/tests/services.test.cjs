'use strict'

// Real TypeScript source, isolated OS boundaries: these tests never spawn/kill a real service.
const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../src/main/services.ts')
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

function harness(options = {}) {
  const spawns = [], processes = [], kills = [], syncKills = [], events = [], sockets = []
  const timeouts = new Map(), intervals = new Map()
  let nextTimer = 1
  let writtenConfig
  const childProcess = {
    spawn(command, args, spawnOptions) {
      if (options.spawnThrows) throw new Error('spawn rejected')
      const proc = new EventEmitter()
      proc.pid = options.noPid ? undefined : 1000 + processes.length
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      proc.stdout.setEncoding = proc.stderr.setEncoding = () => {}
      spawns.push({ command, args, options: spawnOptions })
      processes.push(proc)
      return proc
    },
    execFile(command, args, execOptions, callback) { kills.push({ command, args, options: execOptions, callback }) },
    execFileSync(command, args, execOptions) { syncKills.push({ command, args, options: execOptions }) },
  }
  const fakeNet = {
    connect() {
      const socket = new EventEmitter()
      socket.setTimeout = () => {}
      socket.destroy = () => { socket.destroyed = true }
      sockets.push(socket)
      queueMicrotask(() => {
        if (options.port === 'occupied') socket.emit('connect')
        else if (options.port === 'timeout') socket.emit('timeout')
        else socket.emit('error', Object.assign(new Error('probe error'), { code: options.port || 'ECONNREFUSED' }))
      })
      return socket
    },
  }
  const fakeFs = {
    readFileSync() {
      if (options.config) return JSON.stringify(options.config)
      throw new Error('no saved config')
    },
    statSync() { return { isFile: () => true } },
    existsSync: () => true,
    mkdirSync() {},
    writeFileSync(_file, value) { writtenConfig = JSON.parse(value) },
  }
  const module = { exports: {} }
  const dependencies = {
    './runtime-policy': { validateDetectedPython: () => ({ ok: false, reason: 'No runtime approval in lifecycle fixture' }) },
    child_process: childProcess, net: options.net || fakeNet, path, fs: fakeFs,
    electron: { app: { getPath: () => '/test/userdata', getAppPath: () => '/test/plugin/deskpet-app', isPackaged: false } },
  }
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency: ${name}`)
      return dependencies[name]
    },
    process: { pid: 99, env: {}, resourcesPath: '/test/resources' },
    console: { info() {}, warn() {} },
    setTimeout(fn, ms) { const id = nextTimer++; timeouts.set(id, { fn, ms }); return id },
    clearTimeout(id) { timeouts.delete(id) },
    setInterval(fn) { const id = nextTimer++; intervals.set(id, fn); return id },
    clearInterval(id) { intervals.delete(id) },
  }, { filename: sourcePath })
  const manager = new module.exports.ServiceManager((channel, payload) => events.push({ channel, payload }))
  return {
    manager, spawns, processes, kills, syncKills, events, sockets, timeouts, intervals,
    config: () => writtenConfig,
    state: (id = 'stt-bridge') => manager.list().find(service => service.id === id),
    tick: () => [...intervals.values()].forEach(fn => fn()),
    expire: () => [...timeouts.entries()].forEach(([id, { fn }]) => { timeouts.delete(id); fn() }),
  }
}

for (const id of ['stt-bridge', 'tts-bridge', 'gpt-sovits', 'cloud-tts']) {
  test(`occupied port preserves external process: ${id}`, async () => {
    const h = harness({ port: 'occupied', config: { ttsBackend: 'mimo', ttsApiKey: 'test-only' } })
    await h.manager.start(id)
    assert.equal(h.spawns.length, 0)
    assert.equal(h.kills.length, 0)
    assert.equal(h.syncKills.length, 0)
    assert.equal(h.state(id).status, 'error')
    assert.match(h.state(id).detail, /端口.*已被占用/)
  })
}

test('real loopback listener is preserved (only socket I/O, no real child process)', async () => {
  const server = net.createServer(socket => socket.end())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const h = harness({ net })
    h.manager.defs = () => [{ id: 'stt-bridge', name: 'fixture', port: server.address().port,
      resolve: () => ({ command: 'must-not-run', args: [], cwd: '.' }) }]
    await h.manager.start('stt-bridge')
    assert.equal(server.listening, true)
    assert.equal(h.spawns.length, 0)
    assert.equal(h.kills.length, 0)
    assert.equal(h.state().status, 'error')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

for (const port of ['timeout', 'EACCES']) {
  test(`uncertain port probe fails safely: ${port}`, async () => {
    const h = harness({ port })
    await h.manager.start('stt-bridge')
    assert.equal(h.spawns.length, 0)
    assert.equal(h.state().status, 'error')
    assert.equal(h.sockets[0].destroyed, true)
  })
}

test('ten concurrent starts share one promise and one spawn', async () => {
  const h = harness()
  const gate = deferred()
  h.manager.probePort = () => gate.promise
  const tasks = Array.from({ length: 10 }, () => h.manager.start('stt-bridge'))
  assert.ok(tasks.every(task => task === tasks[0]))
  await flush()
  assert.equal(h.spawns.length, 0)
  gate.resolve(false)
  await Promise.all(tasks)
  assert.equal(h.spawns.length, 1)
  assert.equal(h.state().pid, h.processes[0].pid)
})

test('stop cancels a start waiting for port probe', async () => {
  const h = harness(), gate = deferred()
  h.manager.probePort = () => gate.promise
  const pending = h.manager.start('stt-bridge')
  await flush()
  h.manager.stop('stt-bridge')
  gate.resolve(false)
  await pending
  assert.equal(h.spawns.length, 0)
  assert.equal(h.kills.length, 0)
  assert.equal(h.state().status, 'stopped')
})

test('cancelled start finalizer cannot remove a newer start lock', async () => {
  const h = harness(), first = deferred(), second = deferred()
  let calls = 0
  h.manager.probePort = () => (++calls === 1 ? first.promise : second.promise)
  const old = h.manager.start('stt-bridge')
  await flush()
  h.manager.stop('stt-bridge')
  const current = h.manager.start('stt-bridge')
  await flush()
  first.resolve(false)
  await old
  assert.equal(h.manager.start('stt-bridge'), current)
  second.resolve(false)
  await current
  assert.equal(h.spawns.length, 1)
})

test('restart during preflight cancels old start and starts once', async () => {
  const h = harness(), gate = deferred()
  h.manager.probePort = () => gate.promise
  const pending = h.manager.start('stt-bridge')
  await flush()
  h.manager.probePort = async () => false
  h.manager.restart('stt-bridge')
  await flush()
  gate.resolve(false)
  await pending
  assert.equal(h.spawns.length, 1)
})

test('hotkey old configuration and IPC patches cannot disable stdout event transport', async () => {
  const h = harness({ config: { showTerminal: { hotkey: true, 'stt-bridge': true } } })
  assert.equal(h.manager.getConfig().showTerminal.hotkey, false)
  h.manager.setConfig({ showTerminal: { hotkey: true } })
  assert.equal(h.config().showTerminal.hotkey, false)
  assert.equal(h.config().showTerminal['stt-bridge'], true)
  await h.manager.start('hotkey')
  assert.notEqual(h.spawns[0].command, 'cmd.exe')
  assert.deepEqual([...h.spawns[0].options.stdio], ['ignore', 'pipe', 'pipe'])
  assert.equal(h.spawns[0].options.windowsHide, true)
  h.processes[0].stdout.emit('data', 'PTT_DO')
  h.processes[0].stdout.emit('data', 'WN\r\nPTT_UP\nregular log\n')
  assert.deepEqual(h.events.filter(event => event.channel === 'ptt-event').map(event => event.payload), ['down', 'up'])
  assert.ok(h.manager.logsOf('hotkey').includes('regular log'))
})

test('normal services retain explicitly requested terminal mode', async () => {
  const h = harness({ config: { showTerminal: { 'stt-bridge': true } } })
  await h.manager.start('stt-bridge')
  assert.equal(h.spawns[0].command, 'cmd.exe')
  assert.equal(h.spawns[0].options.windowsHide, true)
})

test('owned process stop is idempotent and uses an argument array', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.stop('stt-bridge')
  h.manager.stop('stt-bridge')
  assert.equal(h.kills.length, 1)
  assert.equal(h.kills[0].command, 'taskkill')
  assert.deepEqual([...h.kills[0].args], ['/pid', String(h.processes[0].pid), '/T', '/F'])
  assert.equal(h.kills[0].options.windowsHide, true)
  h.processes[0].emit('exit', 1)
  assert.equal(h.state().status, 'stopped')
  assert.equal(h.state().pid, null)
})

test('restart waits for exit, repeated restarts create only one replacement', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.restart('stt-bridge')
  h.manager.restart('stt-bridge')
  assert.equal(h.spawns.length, 1)
  assert.equal(h.kills.length, 1)
  assert.equal(h.timeouts.size, 1)
  h.processes[0].emit('exit', 1)
  await flush()
  assert.equal(h.spawns.length, 2)
  assert.equal(h.timeouts.size, 0)
})

test('explicit stop cancels queued restart', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.restart('stt-bridge')
  h.manager.stop('stt-bridge')
  h.processes[0].emit('exit', 0)
  await flush()
  assert.equal(h.spawns.length, 1)
  assert.equal(h.timeouts.size, 0)
})

test('stale control events cannot mutate replacement; retired logs remain attributable', async () => {
  const h = harness()
  await h.manager.start('hotkey')
  const old = h.processes[0]
  h.manager.restart('hotkey')
  old.emit('exit', 0)
  await flush()
  const current = h.processes[1]
  old.emit('exit', 2)
  old.emit('error', new Error('stale failure'))
  old.stdout.emit('data', 'PTT_DOWN\n')
  old.stderr.emit('data', 'old log')
  h.kills[0].callback(new Error('old taskkill callback'))
  assert.equal(h.state('hotkey').pid, current.pid)
  assert.equal(h.state('hotkey').status, 'starting')
  assert.deepEqual(h.events.filter(event => event.channel === 'ptt-event').map(event => event.payload), ['cancel'])
  assert.ok(h.manager.logsOf('hotkey').some(line => line.includes('已退出实例') && line.includes('old log')))
})

test('stop failure retains ownership; explicit stop cancels queued replacement', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.restart('stt-bridge')
  h.kills[0].callback(new Error('access denied'))
  await h.manager.start('stt-bridge')
  assert.equal(h.state().pid, h.processes[0].pid)
  assert.equal(h.state().status, 'error')
  assert.equal(h.spawns.length, 1)
  assert.equal(h.timeouts.size, 1) // Still waiting for confirmed exit or bounded timeout.
  h.manager.stop('stt-bridge')
  assert.equal(h.timeouts.size, 0)
  assert.equal(h.kills.length, 2)
  h.processes[0].emit('exit', 0)
  await flush()
  assert.equal(h.spawns.length, 1)
})

test('restart timeout cancels future restart and permits a new stop attempt', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.restart('stt-bridge')
  h.expire()
  assert.equal(h.state().status, 'error')
  assert.match(h.state().detail, /超时/)
  h.manager.stop('stt-bridge')
  assert.equal(h.kills.length, 2)
  h.kills[0].callback(new Error('stale stop failure'))
  h.processes[0].emit('exit', 1)
  await flush()
  assert.equal(h.state().status, 'stopped')
  assert.equal(h.spawns.length, 1)
})

test('late healthy probe cannot mark replacement as running', async () => {
  const h = harness(), gate = deferred()
  await h.manager.start('stt-bridge')
  h.manager.probePort = () => gate.promise
  h.tick()
  h.manager.restart('stt-bridge')
  h.manager.probePort = async () => false
  h.processes[0].emit('exit', 0)
  await flush()
  gate.resolve(true)
  await flush()
  assert.equal(h.state().pid, h.processes[1].pid)
  assert.equal(h.state().status, 'starting')
})

test('health probe marks only current active process running', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.probePort = async () => true
  h.tick()
  await flush()
  assert.equal(h.state().status, 'running')
})

test('live process error retains ownership, does not spawn duplicates', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.processes[0].emit('error', new Error('operation failed'))
  await h.manager.start('stt-bridge')
  assert.equal(h.state().status, 'error')
  assert.equal(h.state().pid, h.processes[0].pid)
  assert.equal(h.spawns.length, 1)
})

test('spawn failure without pid cleans up and preserves error detail', async () => {
  const h = harness({ noPid: true })
  await h.manager.start('stt-bridge')
  h.processes[0].emit('error', new Error('ENOENT'))
  h.processes[0].emit('exit', 1)
  assert.equal(h.state().pid, null)
  assert.equal(h.state().status, 'error')
  assert.match(h.state().detail, /ENOENT/)
})

test('synchronous spawn exception releases start lock', async () => {
  const h = harness({ spawnThrows: true })
  await h.manager.start('stt-bridge')
  assert.equal(h.state().status, 'error')
  assert.equal(h.manager.starts.size, 0)
})

test('quit cancels pending start and all subsequent starts', async () => {
  const h = harness(), gate = deferred()
  h.manager.probePort = () => gate.promise
  const pending = h.manager.start('stt-bridge')
  await flush()
  h.manager.stopAllSync()
  gate.resolve(false)
  await pending
  await h.manager.start('hotkey')
  assert.equal(h.spawns.length, 0)
  assert.equal(h.kills.length, 0)
})

test('quit cleans only owned processes and clears restart/health timers', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.restart('stt-bridge')
  h.manager.stopAllSync()
  h.processes[0].emit('exit', 0)
  h.kills[0].callback(new Error('quit callback'))
  await flush()
  assert.equal(h.spawns.length, 1)
  assert.equal(h.syncKills.length, 1)
  assert.equal(h.syncKills[0].options.windowsHide, true)
  assert.equal(h.timeouts.size, 0)
  assert.equal(h.intervals.size, 0)
  assert.equal(h.manager.processes.size, 0)
})


test('hotkey stop ignores residual DOWN and emits cancellation once', async () => {
  const h = harness()
  await h.manager.start('hotkey')
  const proc = h.processes[0]
  h.manager.stop('hotkey')
  proc.stdout.emit('data', 'PTT_DOWN\n')
  h.manager.stop('hotkey')
  proc.emit('exit', 1)
  proc.stdout.emit('data', 'PTT_UP\n')
  proc.emit('close', 1)
  assert.deepEqual(h.events.filter(event => event.channel === 'ptt-event').map(event => event.payload), ['cancel'])
})

test('hotkey exit cancels held PTT; trailing logs drain until close', async () => {
  const h = harness()
  await h.manager.start('hotkey')
  const proc = h.processes[0]
  proc.stdout.emit('data', 'PTT_DOWN\n')
  proc.emit('exit', 1)
  proc.stdout.emit('data', 'PTT_UP\ntrailing partial log')
  proc.stderr.emit('data', 'final error diagnostic')
  proc.emit('close', 1)
  proc.stderr.emit('data', 'after-close must disappear')
  assert.deepEqual(h.events.filter(event => event.channel === 'ptt-event').map(event => event.payload), ['down', 'cancel'])
  assert.ok(h.manager.logsOf('hotkey').some(line => line.includes('final error diagnostic')))
  assert.ok(h.manager.logsOf('hotkey').some(line => line.includes('trailing partial log')))
  assert.ok(!h.manager.logsOf('hotkey').some(line => line.includes('after-close')))
  assert.equal(h.manager.lineBuffers.size, 0)
})

test('retired hotkey UP cannot release a new instance key', async () => {
  const h = harness()
  await h.manager.start('hotkey')
  const old = h.processes[0]
  old.stdout.emit('data', 'PTT_DOWN\n')
  h.manager.restart('hotkey')
  old.emit('exit', 0)
  await flush()
  const current = h.processes[1]
  current.stdout.emit('data', 'PTT_DOWN\n')
  old.stdout.emit('data', 'PTT_UP\n')
  old.emit('close', 0)
  current.stdout.emit('data', 'PTT_UP\n')
  assert.deepEqual(h.events.filter(event => event.channel === 'ptt-event').map(event => event.payload), ['down', 'cancel', 'down', 'up'])
})

for (const errorFirst of [true, false]) {
  test(`restart is independent of taskkill error ordering (error first: ${errorFirst})`, async () => {
    const h = harness()
    await h.manager.start('stt-bridge')
    h.manager.restart('stt-bridge')
    if (errorFirst) h.kills[0].callback(new Error('target already exited'))
    assert.equal(h.spawns.length, 1)
    h.processes[0].emit('exit', 0)
    if (!errorFirst) h.kills[0].callback(new Error('target already exited'))
    await flush()
    assert.equal(h.spawns.length, 2)
    assert.equal(h.state().pid, h.processes[1].pid)
  })
}

test('taskkill failure with live target times out without duplicate spawn', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.restart('stt-bridge')
  h.kills[0].callback(new Error('access denied'))
  h.expire()
  assert.equal(h.state().pid, h.processes[0].pid)
  assert.equal(h.spawns.length, 1)
  h.processes[0].emit('exit', 0)
  await flush()
  assert.equal(h.spawns.length, 1)
})

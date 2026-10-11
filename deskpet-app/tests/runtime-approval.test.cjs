'use strict'

// Regression tests for the runtime-approval flow in the main-process ServiceManager.
//
// Scope is deskpet-app/src/main/services.ts ONLY. The ./runtime-policy dependency
// is deliberately mocked: these tests never load the real validator, never touch
// the real filesystem, and never start a real Python process. Every service in
// play is a bridge process (stt-bridge / tts-bridge / gpt-sovits / cloud-tts);
// no microphone, recording, VAD, PTT or hotkey behaviour is exercised.
//
// Harness style mirrors services.test.cjs: transpile services.ts with the
// TypeScript compiler and run it in a vm where fs / child_process / net are
// replaced by fakes, so nothing is ever spawned for real.

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
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

// -- mocked ./runtime-policy -------------------------------------------------
// The real module resolves real paths and stats real files. Here it is a
// scriptable stub, so a test can hand the manager a "valid", an "invalid" or a
// "the canonical path changed between the two validations" answer.

const CANON_A = 'C:\\approved\\runtime\\python.exe'
const CANON_B = 'C:\\relocated\\runtime\\python.exe'
const SRC = 'ws://127.0.0.1:8123/ws'
const ok = (pythonPath, sourceUrl = SRC) => ({ ok: true, pythonPath, sourceUrl })
const invalid = (reason = 'Python path cannot be resolved') => ({ ok: false, reason })

function policyStub(initial = ok(CANON_A)) {
  const state = { result: initial, queue: [], calls: 0 }
  return {
    state,
    set(result) { state.result = result; state.queue.length = 0 },
    push(...results) { state.queue.push(...results) },
    module: {
      validateDetectedPython() {
        state.calls += 1
        if (state.queue.length > 0) return state.queue.shift()
        return state.result
      },
    },
  }
}

function harness(options = {}) {
  const spawns = [], processes = [], kills = [], events = []
  const timeouts = new Map(), intervals = new Map()
  let nextTimer = 1
  const childProcess = {
    spawn(command, args, spawnOptions) {
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
    execFileSync(command, args, execOptions) { kills.push({ command, args, options: execOptions }) },
  }
  const fakeNet = {
    connect() {
      const socket = new EventEmitter()
      socket.setTimeout = () => {}
      socket.destroy = () => {}
      queueMicrotask(() => socket.emit('error', Object.assign(new Error('probe error'), { code: 'ECONNREFUSED' })))
      return socket
    },
  }
  const fakeFs = {
    readFileSync() { throw new Error('no saved config') },
    statSync() { return { isFile: () => true } },
    existsSync: () => true,
    mkdirSync() {},
    writeFileSync() {},
  }
  const policy = options.policy || policyStub()
  const module = { exports: {} }
  const dependencies = {
    child_process: childProcess,
    net: options.net || fakeNet,
    path,
    fs: fakeFs,
    './runtime-policy': policy.module,
    electron: { app: { getPath: () => '/test/userdata', getAppPath: () => '/test/plugin/deskpet-app', isPackaged: false } },
  }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
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
    manager, policy, spawns, processes, kills, events, timeouts, intervals,
    state: (id = 'stt-bridge') => manager.list().find(service => service.id === id),
    tick: () => [...intervals.values()].forEach(fn => fn()),
    report: (pythonPath = 'C:\\reported\\python.exe') => {
      manager.setDetectedPython(pythonPath, SRC)
      return manager.getRuntimeCandidate()?.id
    },
    // Drive stt-bridge into a state where the manager believes it is running.
    markRunning: async (id = 'stt-bridge') => {
      manager.probePort = () => Promise.resolve(true)
      ;[...intervals.values()].forEach(fn => fn())
      await flush()
      return manager.list().find(service => service.id === id)
    },
  }
}

// 1 ---------------------------------------------------------------------------
test('a reported candidate is stored for review but never executed', async () => {
  const h = harness()
  h.manager.setDetectedPython('C:\\reported\\python.exe', SRC)

  const candidate = h.manager.getRuntimeCandidate()
  assert.ok(candidate, 'the candidate must be kept for review')
  assert.equal(candidate.pythonPath, CANON_A)
  assert.equal(candidate.sourceUrl, SRC)
  assert.equal(h.spawns.length, 0, 'reporting a candidate must not spawn anything')
  assert.equal(h.manager.python(), 'python', 'python() must stay on the fallback before approval')

  await h.manager.start('stt-bridge')
  assert.equal(h.spawns.length, 1)
  assert.equal(h.spawns[0].command, 'python', 'an unapproved candidate must not be used to launch')
})

// 2 ---------------------------------------------------------------------------
test('only approval selects the detected interpreter', async () => {
  const h = harness()
  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  assert.equal(h.manager.python(), CANON_A)
  assert.equal(h.manager.getRuntimeCandidate(), null, 'an approved candidate is consumed')
})

// 3 ---------------------------------------------------------------------------
test('an unknown id never approves', async () => {
  const h = harness()
  h.report()
  assert.equal(h.manager.approveDetectedPython('not-the-id'), false)
  assert.equal(h.manager.python(), 'python')
  assert.ok(h.manager.getRuntimeCandidate(), 'a failed approval must not consume the candidate')
})

// 4 ---------------------------------------------------------------------------
test('approving twice approves only once', async () => {
  const h = harness()
  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  assert.equal(h.manager.approveDetectedPython(id), false)
  assert.equal(h.manager.python(), CANON_A)
  assert.equal(h.manager.getRuntimeCandidate(), null)
})

// 5 ---------------------------------------------------------------------------
test('clearDetectedPython revokes an approved interpreter', async () => {
  const h = harness()
  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  assert.equal(h.manager.python(), CANON_A)

  h.manager.clearDetectedPython()
  assert.equal(h.manager.python(), 'python', 'revoked runtime must fall back')
  assert.equal(h.manager.getRuntimeCandidate(), null)
  assert.equal(h.manager.approveDetectedPython(id), false, 'a stale id cannot be re-approved after clear')
})

// 6 ---------------------------------------------------------------------------
test('a new candidate invalidates the previous id', async () => {
  const h = harness()
  const first = h.report('C:\\reported\\first.exe')

  h.policy.set(ok(CANON_B))
  const second = h.report('C:\\reported\\second.exe')
  assert.notEqual(second, first, 'the new report must mint a new id')

  assert.equal(h.manager.approveDetectedPython(first), false, 'the superseded id must be rejected')
  assert.equal(h.manager.python(), 'python')
  assert.equal(h.manager.approveDetectedPython(second), true)
  assert.equal(h.manager.python(), CANON_B)
})

// 7 ---------------------------------------------------------------------------
test('a canonical path that changes between report and approval is rejected', async () => {
  const h = harness()
  const id = h.report()
  assert.equal(h.manager.getRuntimeCandidate().pythonPath, CANON_A)

  // realpath resolves somewhere else on the approval pass
  h.policy.set(ok(CANON_B))
  assert.equal(h.manager.approveDetectedPython(id), false)
  assert.equal(h.manager.python(), 'python')
  assert.equal(h.manager.getRuntimeCandidate(), null, 'a changed path must drop the candidate')
})

// 8 ---------------------------------------------------------------------------
test('an invalid report clears any pending candidate', async () => {
  const h = harness()
  h.report()
  assert.ok(h.manager.getRuntimeCandidate())

  h.policy.set(invalid())
  h.manager.setDetectedPython('C:\\reported\\python.exe', SRC)
  assert.equal(h.manager.getRuntimeCandidate(), null)
  assert.equal(h.manager.python(), 'python')
})

// 9 ---------------------------------------------------------------------------
test('an explicit pythonPath wins and suppresses the automatic retry', async () => {
  const h = harness({ noPid: true })
  await h.manager.start('stt-bridge')
  h.processes[0].emit('error', new Error('spawn python ENOENT'))
  assert.equal(h.state('stt-bridge').status, 'error')
  assert.match(h.state('stt-bridge').detail, /ENOENT/)

  h.manager.setConfig({ pythonPath: 'C:\\Explicit\\python.exe' })
  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  await flush()

  assert.equal(h.manager.python(), 'C:\\Explicit\\python.exe', 'the configured path must win')
  assert.equal(h.spawns.length, 1, 'an explicit path must not trigger the approval retry')
})

// 10 --------------------------------------------------------------------------
test('an already running service is not restarted by approval', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  const running = await h.markRunning()
  assert.equal(running.status, 'running')

  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  await flush()

  assert.equal(h.manager.python(), CANON_A, 'approval still selects the interpreter')
  assert.equal(h.spawns.length, 1, 'a running service must not be restarted')
})

// 11 --------------------------------------------------------------------------
test('a service the user stopped is not restarted by approval', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.manager.stop('stt-bridge')
  h.processes[0].emit('exit', 0)
  await flush()
  assert.equal(h.state('stt-bridge').status, 'stopped')

  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  await flush()
  assert.equal(h.spawns.length, 1, 'a user stop must not be undone by approval')
})

// 12 --------------------------------------------------------------------------
test('a service without autoStart is not retried by approval', async () => {
  const h = harness({ noPid: true })
  h.manager.setConfig({ autoStart: { 'stt-bridge': false } })
  await h.manager.start('stt-bridge')
  h.processes[0].emit('error', new Error('spawn python ENOENT'))
  assert.equal(h.state('stt-bridge').status, 'error')
  assert.equal(h.state('stt-bridge').autoStart, false)

  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  await flush()
  assert.equal(h.spawns.length, 1, 'autoStart=false must never be retried')
})

// 13 --------------------------------------------------------------------------
test('an ordinary runtime crash is not retried by approval', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.processes[0].emit('exit', 1)
  await flush()
  assert.equal(h.state('stt-bridge').status, 'error')
  assert.doesNotMatch(h.state('stt-bridge').detail, /ENOENT/)
  assert.equal(h.manager.runtimeFailures.get('stt-bridge'), undefined)

  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  await flush()
  assert.equal(h.spawns.length, 1, 'a plain crash is not an environment failure')
})

// 14 --------------------------------------------------------------------------
test('an ENOENT failure is retried exactly once after approval', async () => {
  const h = harness({ noPid: true })
  await h.manager.start('stt-bridge')
  h.processes[0].emit('error', new Error('spawn python ENOENT'))
  assert.equal(h.state('stt-bridge').status, 'error')
  assert.match(h.state('stt-bridge').detail, /ENOENT/)

  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  await flush()
  assert.equal(h.manager.python(), CANON_A)
  assert.equal(h.spawns.length, 2, 'the confirmed interpreter retries the failed launch once')

  assert.equal(h.manager.approveDetectedPython(id), false, 'the candidate is consumed')
  h.processes[1].emit('error', new Error('spawn python ENOENT'))
  await flush()
  assert.equal(h.spawns.length, 2, 'a second failure must not loop')
})

// 15 --------------------------------------------------------------------------
test('a missing-dependency failure is retried exactly once after approval', async () => {
  const h = harness()
  await h.manager.start('stt-bridge')
  h.processes[0].stderr.emit('data', "ModuleNotFoundError: No module named 'sensevoice'\n")
  h.processes[0].emit('exit', 1)
  await flush()
  assert.equal(h.state('stt-bridge').status, 'error')
  assert.equal(h.manager.runtimeFailures.get('stt-bridge'), 'missing-dependency')

  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  await flush()
  assert.equal(h.spawns.length, 2, 'a confirmed interpreter retries the dependency failure once')

  h.processes[1].stderr.emit('data', "ModuleNotFoundError: No module named 'sensevoice'\n")
  h.processes[1].emit('exit', 1)
  await flush()
  assert.equal(h.spawns.length, 2, 'the retry must not recurse')
})

// 16 --------------------------------------------------------------------------
test('clearing during a pending port probe prevents the spawn', async () => {
  const h = harness()
  const id = h.report()
  assert.equal(h.manager.approveDetectedPython(id), true)
  assert.equal(h.manager.python(), CANON_A)

  const gate = deferred()
  h.manager.probePort = () => gate.promise
  const pending = h.manager.start('stt-bridge')
  await flush()
  assert.equal(h.spawns.length, 0, 'nothing may spawn before the probe resolves')

  h.manager.clearDetectedPython()
  gate.resolve(false)
  await pending
  await flush()

  assert.equal(h.spawns.length, 0, 'a start pending on a probe must be cancelled by clear')
  assert.equal(h.state('stt-bridge').status, 'stopped')
  assert.equal(h.manager.python(), 'python')
})
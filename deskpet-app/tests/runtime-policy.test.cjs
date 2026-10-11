'use strict'

// runtime-policy.ts 的独立回归测试：只用 Node 内置 test runner + TypeScript transpile + vm 替身。
// path / fs 全部是可控替身，绝不触碰真实文件系统；不启动任何进程、不执行 Python、
// 不联网，也不涉及麦克风 / 录音 / VAD / PTT。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const nodePath = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const sourcePath = nodePath.resolve(__dirname, '../src/main/runtime-policy.ts')
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: sourcePath,
}).outputText

// path 的可控替身：只暴露 win32 basename，保证跨宿主平台语义一致。
const fakePath = { basename: value => nodePath.win32.basename(value) }
const SECRET = 'super-secret-token-9000'
const OK_PY = 'C:\\Python311\\python.exe'
const OK_URL = 'ws://127.0.0.1:8080/ws'

function loadPolicy(overrides = {}) {
  const calls = { realpath: [], stat: [] }
  const fsDouble = {
    realpathSync(value) {
      calls.realpath.push(value)
      if (Object.hasOwn(overrides, 'realpathSync')) return overrides.realpathSync(value)
      return value
    },
    statSync(value) {
      calls.stat.push(value)
      if (Object.hasOwn(overrides, 'statSync')) return overrides.statSync(value)
      return { isFile: () => true }
    },
  }
  const module = { exports: {} }
  const dependencies = { fs: fsDouble, path: fakePath }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency: ${name}`)
      return dependencies[name]
    },
    URL,
  }, { filename: sourcePath })
  assert.equal(typeof module.exports.validateDetectedPython, 'function')
  return { validate: module.exports.validateDetectedPython, calls }
}

function assertRejected(validate, pythonPath, sourceUrl) {
  const result = validate(pythonPath, sourceUrl)
  assert.equal(result.ok, false)
  assert.equal(typeof result.reason, 'string')
  assert.ok(result.reason.length > 0, 'reason must be non-empty')
  assert.ok(!('pythonPath' in result) && !('sourceUrl' in result), 'failure must not carry candidates')
  return result
}

test('accepts a normal local drive interpreter and loopback ws url', () => {
  const { validate, calls } = loadPolicy()
  const result = validate(OK_PY, OK_URL)
  assert.equal(result.ok, true)
  assert.equal(result.pythonPath, OK_PY)
  assert.equal(result.sourceUrl, OK_URL)
  assert.deepEqual(calls.realpath, [OK_PY])
  assert.deepEqual(calls.stat, [OK_PY])
})

test('accepts spaces, non-ascii segments and case-insensitive basenames', () => {
  const { validate } = loadPolicy()
  for (const py of [
    'C:\\Program Files\\Python311\\python.exe',
    'D:\\工具\\Python311\\pythonw.exe',
    'c:\\Python311\\PYTHON.EXE',
  ]) {
    const result = validate(py, OK_URL)
    assert.equal(result.ok, true)
    assert.equal(result.pythonPath, py)
    assert.equal(result.sourceUrl, OK_URL)
  }
})

test('accepts loopback variants including IPv6 and normalized IPv4', () => {
  const { validate } = loadPolicy()
  assert.equal(validate(OK_PY, 'ws://[::1]:9000/ws').sourceUrl, 'ws://[::1]:9000/ws')
  assert.equal(validate(OK_PY, 'ws://[0:0:0:0:0:0:0:1]:9000/x').sourceUrl, 'ws://[::1]:9000/x')
  assert.equal(validate(OK_PY, 'wss://localhost:9443/app').sourceUrl, 'wss://localhost:9443/app')
  assert.equal(validate(OK_PY, 'ws://127.000.000.001:8080/').sourceUrl, 'ws://127.0.0.1:8080/')
  assert.equal(validate(OK_PY, 'ws://localhost:8080').sourceUrl, 'ws://localhost:8080/')
})

test('strips query and hash so tokens never leak into the candidate', () => {
  const { validate } = loadPolicy()
  const result = validate(OK_PY, `ws://127.0.0.1:8080/path?token=${SECRET}#frag`)
  assert.equal(result.ok, true)
  assert.equal(result.sourceUrl, 'ws://127.0.0.1:8080/path')
  assert.ok(!result.sourceUrl.includes(SECRET))
  assert.ok(!result.sourceUrl.includes('frag'))
})

test('rejects remote hosts, fake localhost and userinfo without leaking tokens', () => {
  const { validate } = loadPolicy()
  for (const url of [
    'ws://192.168.1.5:8080/',
    'ws://10.0.0.1/',
    'wss://example.com/',
    'ws://localhost.evil.com/',
    'ws://notlocalhost/',
    'ws://127.0.0.1.evil.com/',
    'ws://user@127.0.0.1:8080/',
    'ws://user:pass@localhost/',
    `ws://user@127.0.0.1:8080/?token=${SECRET}`,
  ]) {
    const result = assertRejected(validate, OK_PY, url)
    assert.ok(!result.reason.includes(SECRET), 'reason must not leak the token')
  }
})

test('rejects non-ws protocols and malformed urls', () => {
  const { validate } = loadPolicy()
  for (const url of [
    'http://127.0.0.1:8080/',
    'https://localhost/',
    'file:///C:/x',
    'ftp://127.0.0.1/',
    'ws://',
    'not a url',
    '',
  ]) {
    assertRejected(validate, OK_PY, url)
  }
})

test('rejects remote or non-ws sources without any file probing', () => {
  const { validate, calls } = loadPolicy()
  for (const url of [
    'ws://192.168.1.5:8080/',
    'ws://10.0.0.1/',
    'wss://example.com/',
    'ws://localhost.evil.com/',
    'ws://127.0.0.1.evil.com/',
    'ws://user@127.0.0.1:8080/',
    'http://127.0.0.1:8080/',
    'https://localhost/',
    'file:///C:/x',
    'not a url',
    '',
  ]) {
    assertRejected(validate, OK_PY, url)
  }
  // URL 校验在前：任何被拒来源都不应触发 fs.realpath/stat
  assert.equal(calls.realpath.length, 0)
  assert.equal(calls.stat.length, 0)
})

test('rejects non-string python path and source url', () => {
  const { validate } = loadPolicy()
  for (const value of [null, undefined, 123, {}, []]) {
    assertRejected(validate, value, OK_URL)
    assertRejected(validate, OK_PY, value)
  }
})

test('rejects relative, UNC and device paths', () => {
  const { validate } = loadPolicy()
  for (const py of [
    'python.exe',
    '.\\python.exe',
    '..\\Python\\python.exe',
    'Python\\python.exe',
    'C:python.exe',
    '\\\\server\\share\\python.exe',
    '//server/share/python.exe',
    '\\\\?\\C:\\Python\\python.exe',
    '\\\\.\\C:\\Python\\python.exe',
    '\\\\?\\UNC\\server\\share\\python.exe',
  ]) {
    assertRejected(validate, py, OK_URL)
  }
})

test('rejects disallowed interpreter basenames', () => {
  const { validate } = loadPolicy()
  for (const py of [
    'C:\\Python311\\python3.exe',
    'C:\\Python311\\python.bat',
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Python311\\python.exe.bak',
    'C:\\Python311\\notpython.exe',
    'C:\\Python311\\',
    'C:\\Python311',
  ]) {
    assertRejected(validate, py, OK_URL)
  }
})

test('rejects control characters and shell metacharacters', () => {
  const { validate } = loadPolicy()
  for (const py of [
    'C:\\Py\\python.exe\u0000',
    'C:\\Py\\py\u0000thon.exe',
    'C:\\Py\\python.exe\n',
    'C:\\Py\\py\nthon.exe',
    'C:\\Py\\python.exe\r',
    'C:\\Py\\python.exe\t',
    'C:\\Py\\python.exe&calc',
    'C:\\Py&Calc\\python.exe',
    'C:\\Py\\python.exe|more',
    'C:\\Py\\python.exe>out',
    'C:\\Py\\python.exe^&whoami',
    'C:\\Py\\python%TEMP%.exe',
    'C:\\Py\\python.exe;calc',
    'C:\\Py\\python.exe`calc',
  ]) {
    assertRejected(validate, py, OK_URL)
  }
})

test('rejects missing files, directories and unreadable stat', () => {
  const missing = loadPolicy({ realpathSync: () => { throw new Error('ENOENT') } })
  assertRejected(missing.validate, OK_PY, OK_URL)

  const directory = loadPolicy({ statSync: () => ({ isFile: () => false }) })
  assertRejected(directory.validate, OK_PY, OK_URL)

  const unreadable = loadPolicy({ statSync: () => { throw new Error('EACCES') } })
  assertRejected(unreadable.validate, OK_PY, OK_URL)
})

test('rejects unsafe realpath targets before touching stat', () => {
  for (const resolved of [
    '\\\\server\\share\\python.exe',
    '//server/share/python.exe',
    '\\\\?\\C:\\Python\\python.exe',
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Windows\\System32\\python3.exe',
    'C:\\Python311\\python.exe.bak',
  ]) {
    const { validate, calls } = loadPolicy({ realpathSync: () => resolved })
    assertRejected(validate, OK_PY, OK_URL)
    assert.equal(calls.stat.length, 0)
  }
})

test('validates the resolved path instead of the raw input', () => {
  const resolved = 'C:\\Real\\Python311\\python.exe'
  const { validate, calls } = loadPolicy({ realpathSync: () => resolved })
  const result = validate('C:\\Link\\python.exe', OK_URL)
  assert.equal(result.ok, true)
  assert.equal(result.pythonPath, resolved)
  assert.equal(result.sourceUrl, OK_URL)
  assert.deepEqual(calls.stat, [resolved])
})

test('reads only fs/path metadata doubles (no process, network or python execution)', () => {
  // loadPolicy 的 require 守卫会在模块引入 fs/path 之外的依赖时直接失败。
  const { validate, calls } = loadPolicy()
  validate(OK_PY, OK_URL)
  assert.deepEqual(calls.realpath, [OK_PY])
  assert.deepEqual(calls.stat, [OK_PY])
})
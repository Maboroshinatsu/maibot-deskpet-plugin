'use strict'
// DP-017 验收：宿主边界模块不得依赖 Vue / Pinia / Electron / DOM / Node fs。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { HOST_DIR } = require('./helpers/host-loader.cjs')

const MODULES = ['contracts.ts', 'maibot-protocol.ts', 'event-controller.ts', 'fake-host.ts']

// 只扫描 import 语句与运行期全局，避免误伤注释里提到的框架名。
const FORBIDDEN_SPECIFIERS = [/^vue$/, /^pinia$/, /^electron$/, /^node:/, /^fs$/, /^path$/, /@\/stores\//, /@\/composables\//]
const FORBIDDEN_RUNTIME = [/\bwindow\s*\./, /\bdocument\s*\./, /\blocalStorage\b/, /\bnew WebSocket\b/, /\bnew Audio\b/, /\brequire\s*\(/]

for (const name of MODULES) {
  test(`${name} stays host-agnostic`, () => {
    const src = fs.readFileSync(path.join(HOST_DIR, name), 'utf8')
    const imports = [...src.matchAll(/^\s*import\s[^\n]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    for (const spec of imports) {
      for (const bad of FORBIDDEN_SPECIFIERS) {
        assert.equal(bad.test(spec), false, `${name} must not import ${spec}`)
      }
      assert.ok(spec.startsWith('./') || spec.startsWith('../'),
        `${name} may only import relatively, got ${spec}`)
    }
    for (const bad of FORBIDDEN_RUNTIME) {
      assert.equal(bad.test(src), false, `${name} must not use ${bad}`)
    }
  })
}

test('host modules do not reach into platform IPC directly', () => {
  for (const name of MODULES) {
    const src = fs.readFileSync(path.join(HOST_DIR, name), 'utf8')
    assert.equal(/electronAPI/.test(src), false, `${name} must not call electronAPI`)
  }
})

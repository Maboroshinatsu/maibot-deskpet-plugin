'use strict'
// 在 vm 中加载 host/ 下的 TypeScript 模块，只允许相对导入，便于断言边界。
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const HOST_DIR = path.resolve(__dirname, '../../src/renderer/services/host')
const cache = new Map()

function loadHostModule(name) {
  const key = name.replace(/\.ts$/, '')
  if (cache.has(key)) return cache.get(key)
  const file = path.join(HOST_DIR, key + '.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  const requireShim = (spec) => {
    if (spec.startsWith('./')) return loadHostModule(spec.slice(2))
    // 类型专用导入会被 transpile 擦除；这里仅防御性放行协议类型
    if (spec.startsWith('../protocol')) return {}
    throw new Error(`host module may not depend on: ${spec}`)
  }
  vm.runInNewContext(code, { module, exports: module.exports, require: requireShim, console }, { filename: file })
  cache.set(key, module.exports)
  return module.exports
}

/**
 * 加载 host/ 之外、但同样应保持纯逻辑（只允许相对导入）的渲染层模块。
 * 用于让 useWebSocket 这类组合式函数的边界测试拿到真实实现，而不是打桩。
 */
function loadTsModule(absPath) {
  const key = absPath
  if (cache.has(key)) return cache.get(key)
  const code = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  const requireShim = (spec) => {
    if (spec.startsWith('.')) return loadTsModule(path.resolve(path.dirname(absPath), spec) + '.ts')
    throw new Error(`module may not depend on: ${spec}`)
  }
  vm.runInNewContext(code, { module, exports: module.exports, require: requireShim, console }, { filename: absPath })
  cache.set(key, module.exports)
  return module.exports
}

module.exports = { loadHostModule, loadTsModule, HOST_DIR }

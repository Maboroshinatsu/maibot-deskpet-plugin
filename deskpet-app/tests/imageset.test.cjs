'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/services/imageset/loader.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function load(page, responseUrl, body = JSON.stringify({ images: { neutral: 'neutral.svg' }, talk: 'talk.svg' })) {
  const module = { exports: {} }, requests = []
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, console: { info() {} }, window: { location: { href: page } },
    fetch: async url => { requests.push(url); return { ok: true, url: responseUrl || '', text: async () => body } },
  })
  return { load: module.exports.loadImageSet, requests }
}
for (const page of [
  'file:///D:/Test%20Project/out/renderer/index.html',
  'http://127.0.0.1:5173/index.html',
  'http://127.0.0.1:5173/subdir/index.html',
]) {
  test(`relative manifest resolves images and talk: ${page}`, async () => {
    const h = load(page)
    const manifest = './models/sample_static/deskpet-images.json'
    const absolute = new URL(manifest, page).href
    const result = await h.load(manifest)
    assert.equal(h.requests[0], absolute)
    assert.equal(result.images.neutral, new URL('neutral.svg', absolute).href)
    assert.equal(result.talk, new URL('talk.svg', absolute).href)
  })
}
test('custom deskpet protocol remains unchanged', async () => {
  const h = load('file:///D:/app/index.html')
  const result = await h.load('deskpet://models/sample/deskpet-images.json')
  assert.equal(result.images.neutral, 'deskpet://models/sample/neutral.svg')
})
test('redirected HTTP manifests resolve images relative to final response URL', async () => {
  const h = load('http://localhost/index.html', 'http://localhost/assets/v2/deskpet-images.json')
  const result = await h.load('./original.json')
  assert.equal(result.images.neutral, 'http://localhost/assets/v2/neutral.svg')
})
test('spaces and non-ASCII model paths are resolved safely', async () => {
  const h = load('file:///D:/app/index.html')
  const manifest = './models/静态 立绘/deskpet-images.json'
  const result = await h.load(manifest)
  assert.equal(result.images.neutral, new URL('neutral.svg', new URL(manifest, 'file:///D:/app/index.html')).href)
})
test('HTML fallback still reports an invalid manifest', async () => {
  const h = load('http://localhost/index.html', '', '<html>fallback</html>')
  await assert.rejects(h.load('./missing.json'), /不是有效的 JSON/)
})

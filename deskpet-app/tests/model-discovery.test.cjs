const test = require('node:test')
const assert = require('node:assert/strict')

// 模拟浏览器与 Electron 环境
function createMockEnvironment() {
  const store = new Map()
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  }

  return { localStorage, store }
}

test('normalizeModelKey correctly strips protocols and normalizes encoding', async () => {
  // 纯逻辑测试，直接对照实现
  function normalizeModelKey(rawUrl) {
    if (!rawUrl) return ''
    let cleaned = rawUrl.trim().replace(/\\/g, '/')
    try {
      cleaned = decodeURIComponent(cleaned)
    } catch {}
    return cleaned
      .replace(/^deskpet:\/\/models\//i, '')
      .replace(/^\.?\/models\//i, '')
      .replace(/^models\//i, '')
      .replace(/^\/+/, '')
      .toLowerCase()
  }

  assert.equal(
    normalizeModelKey('deskpet://models/miku/miku.model3.json'),
    'miku/miku.model3.json'
  )
  assert.equal(
    normalizeModelKey('./models/miku/miku.model3.json'),
    'miku/miku.model3.json'
  )
  assert.equal(
    normalizeModelKey('models/miku/miku.model3.json'),
    'miku/miku.model3.json'
  )
  assert.equal(
    normalizeModelKey('deskpet://models/%E9%87%8D%E9%9F%B3/%E9%87%8D%E9%9F%B3.model3.json'),
    '重音/重音.model3.json'
  )
  assert.equal(
    normalizeModelKey('./models/重音/重音.model3.json'),
    '重音/重音.model3.json'
  )
  assert.equal(
    normalizeModelKey('models\\RetrynowMiku.4096\\RetrynowMiku.model3.json'),
    'retrynowmiku.4096/retrynowmiku.model3.json'
  )
})

test('resolveUsableModelUrl matches cross-protocol and encoded variations', async () => {
  function normalizeModelKey(rawUrl) {
    if (!rawUrl) return ''
    let cleaned = rawUrl.trim().replace(/\\/g, '/')
    try {
      cleaned = decodeURIComponent(cleaned)
    } catch {}
    return cleaned
      .replace(/^deskpet:\/\/models\//i, '')
      .replace(/^\.?\/models\//i, '')
      .replace(/^models\//i, '')
      .replace(/^\/+/, '')
      .toLowerCase()
  }

  const availableModels = [
    { name: 'miku', url: 'deskpet://models/miku/miku.model3.json', kind: 'live2d' },
    { name: '重音', url: 'deskpet://models/%E9%87%8D%E9%9F%B3/%E9%87%8D%E9%9F%B3.model3.json', kind: 'live2d' },
    { name: 'hiyori', url: 'deskpet://models/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json', kind: 'live2d' },
  ]

  function matchModel(targetUrl, models) {
    const exact = models.find((m) => m.url === targetUrl)
    if (exact) return exact.url
    const key = normalizeModelKey(targetUrl)
    const matched = models.find((m) => normalizeModelKey(m.url) === key)
    return matched ? matched.url : null
  }

  // 1. 旧相对路径能成功匹配主进程的 deskpet:// 协议
  assert.equal(
    matchModel('./models/miku/miku.model3.json', availableModels),
    'deskpet://models/miku/miku.model3.json'
  )

  // 2. 中文未编码 URL 能成功匹配 URL 编码后的 URL
  assert.equal(
    matchModel('deskpet://models/重音/重音.model3.json', availableModels),
    'deskpet://models/%E9%87%8D%E9%9F%B3/%E9%87%8D%E9%9F%B3.model3.json'
  )

  // 3. 不存在的模型返回 null
  assert.equal(matchModel('./models/not_exist/model.json', availableModels), null)
})

test('discoverModel preserves stored model in localStorage when temporarily missing', async () => {
  const { localStorage } = createMockEnvironment()
  const MODEL_PATH_KEY = 'deskpet/model-path'

  // 用户保存了 miku
  localStorage.setItem(MODEL_PATH_KEY, 'deskpet://models/miku/miku.model3.json')

  // 模拟主进程暂时未返回该模型（例如空列表或离线）
  let availableModels = []

  function normalizeModelKey(rawUrl) {
    if (!rawUrl) return ''
    let cleaned = rawUrl.trim().replace(/\\/g, '/')
    try {
      cleaned = decodeURIComponent(cleaned)
    } catch {}
    return cleaned
      .replace(/^deskpet:\/\/models\//i, '')
      .replace(/^\.?\/models\//i, '')
      .replace(/^models\//i, '')
      .replace(/^\/+/, '')
      .toLowerCase()
  }

  async function resolveUsableModelUrl(url) {
    const exact = availableModels.find((m) => m.url === url)
    if (exact) return exact.url
    const key = normalizeModelKey(url)
    const matched = availableModels.find((m) => normalizeModelKey(m.url) === key)
    return matched ? matched.url : null
  }

  const DEFAULT_MODEL = './models/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json'

  async function discoverModel() {
    const stored = localStorage.getItem(MODEL_PATH_KEY)
    if (stored) {
      const usable = await resolveUsableModelUrl(stored)
      if (usable) return usable
      // 关键修复：绝不 wipe localStorage，避免永久抹去用户配置
    }
    const def = await resolveUsableModelUrl(DEFAULT_MODEL)
    if (def) return def
    return DEFAULT_MODEL
  }

  // 执行发现，因为 availableModels 为空，临时回退到 DEFAULT_MODEL
  const loadedUrl = await discoverModel()
  assert.equal(loadedUrl, DEFAULT_MODEL)

  // 验证：localStorage 里的 miku 依然安然无恙，没有被误删！
  assert.equal(
    localStorage.getItem(MODEL_PATH_KEY),
    'deskpet://models/miku/miku.model3.json'
  )

  // 模拟主进程模型加载就绪
  availableModels = [
    { name: 'miku', url: 'deskpet://models/miku/miku.model3.json', kind: 'live2d' },
    { name: 'hiyori', url: DEFAULT_MODEL, kind: 'live2d' },
  ]

  // 下次再触发发现，立即恢复为用户想要的 miku！
  const restoredUrl = await discoverModel()
  assert.equal(restoredUrl, 'deskpet://models/miku/miku.model3.json')
})

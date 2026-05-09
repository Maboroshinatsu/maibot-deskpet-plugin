/**
 * Live2D 模型自发现
 *
 * 扫描 public/models/ 目录，寻找可用的模型文件。
 * 支持:
 *   - *.model3.json 文件（标准 Cubism 4 模型）
 *   - *.zip 文件（压缩的模型包）
 *   - 包含单个 .moc3 的目录（通过文件系统扫描）
 */
import { MODEL_PATH } from '@/services/model-config'

let cachedModelUrl: string | null = null

async function fileExists(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { method: 'HEAD' })
    return resp.ok
  } catch {
    return false
  }
}

export async function discoverModel(): Promise<string> {
  if (cachedModelUrl) return cachedModelUrl

  if (await fileExists(MODEL_PATH)) {
    cachedModelUrl = MODEL_PATH
    return cachedModelUrl
  }

  const commonNames = [
    'hiyori_free', 'hiyori_pro', 'haru', 'mao',
    'default', 'model', 'character', 'live2d'
  ]
  const extensions = ['model3.json', 'moc3']

  for (const name of commonNames) {
    for (const ext of extensions) {
      const url = `../models/${name}/${name}.${ext}`
      if (await fileExists(url)) {
        cachedModelUrl = url
        console.log(`[ModelDiscovery] Found model: ${url}`)
        return cachedModelUrl
      }
    }
  }

  for (const name of commonNames) {
    const url = `../models/${name}.zip`
    if (await fileExists(url)) {
      cachedModelUrl = url
      console.log(`[ModelDiscovery] Found model archive: ${url}`)
      return cachedModelUrl
    }
  }

  console.warn('[ModelDiscovery] No model found in public/models/')
  console.warn('[ModelDiscovery] Expected structure: public/models/<name>/<name>.model3.json')
  console.warn('[ModelDiscovery] Or:              public/models/<name>.zip')
  return ''
}

export function clearModelCache(): void {
  cachedModelUrl = null
}

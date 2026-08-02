/**
 * 静态立绘包清单加载器
 *
 * 立绘包 = models/ 下的一个文件夹，内含 deskpet-images.json：
 * {
 *   "name": "展示名（可选，默认用文件夹名）",
 *   "default": "neutral",            // 未映射情绪的回落图（缺省取第一张）
 *   "images": {                      // 情绪名 → 图片相对路径（png/jpg/webp/svg/gif）
 *     "neutral": "neutral.png",
 *     "happy": "happy.png"
 *   },
 *   "talk": "talk.png"               // 可选：TTS 说话时的差分图
 * }
 *
 * 支持的情绪名与 Live2D adapter 一致：
 * happy / sad / angry / surprise / thinking / shy / curious / neutral / idle
 */

export interface ImageSetManifest {
  /** 清单里声明的展示名（可能为空，由调用方回落） */
  name: string
  /** 标定的默认表情（normal）：未映射情绪的回落键，也是 6 秒自动回退的目标 */
  default: string
  /** 情绪名 → 已解析为绝对 URL 的图片地址 */
  images: Record<string, string>
  /** 可选说话差分（已解析 URL） */
  talk?: string
  /** 待机随机情绪池；缺省 = 全部非默认键；空数组 = 关闭 */
  idleEmotions: string[]
  /** 待机随机情绪的间隔范围（秒），默认 [12, 25] */
  idleInterval: [number, number]
}

/** 默认表情解析顺序：显式 default > "normal" > "neutral" > 第一张图 */
function resolveDefault(rawDefault: unknown, images: Record<string, string>): string {
  if (typeof rawDefault === 'string' && images[rawDefault]) return rawDefault
  if (images['normal']) return 'normal'
  if (images['neutral']) return 'neutral'
  return Object.keys(images)[0]
}

export async function loadImageSet(manifestUrl: string): Promise<ImageSetManifest> {
  const resp = await fetch(manifestUrl, { cache: 'no-cache' })
  if (!resp.ok) throw new Error(`清单加载失败 HTTP ${resp.status}`)

  // dev server 对不存在路径会回 index.html，直接 json() 会抛看不懂的错
  const text = await resp.text()
  if (!text.trimStart().startsWith('{')) {
    throw new Error('deskpet-images.json 不是有效的 JSON（或文件不存在）')
  }
  const raw = JSON.parse(text)

  const src = raw?.images
  if (!src || typeof src !== 'object') {
    throw new Error('deskpet-images.json 缺少 images 字段')
  }

  const images: Record<string, string> = {}
  for (const [emotion, file] of Object.entries(src)) {
    if (typeof emotion === 'string' && emotion && typeof file === 'string' && file) {
      images[emotion] = new URL(file, manifestUrl).toString()
    }
  }
  const keys = Object.keys(images)
  if (keys.length === 0) throw new Error('deskpet-images.json 的 images 为空')

  const fallback = resolveDefault(raw.default, images)
  if (typeof raw.default !== 'string' || !images[raw.default]) {
    console.info(`[ImageSet] 未标定 default，回落到 "${fallback}"（建议在清单里显式标定默认表情）`)
  }

  // 待机随机情绪池：只保留真实存在的键；显式空数组 = 关闭待机随机
  const idleEmotions = Array.isArray(raw.idleEmotions)
    ? raw.idleEmotions.filter((k: unknown): k is string => typeof k === 'string' && !!images[k])
    : keys.filter((k) => k !== fallback)

  // 间隔范围：非法值回落默认 [12, 25]，下限钳到 3 秒
  let idleInterval: [number, number] = [12, 25]
  if (
    Array.isArray(raw.idleIntervalSec) &&
    raw.idleIntervalSec.length === 2 &&
    raw.idleIntervalSec.every((n: unknown) => typeof n === 'number' && (n as number) > 0)
  ) {
    const [a, b] = raw.idleIntervalSec as [number, number]
    idleInterval = [Math.max(3, Math.min(a, b)), Math.max(a, b)]
  }

  return {
    name: typeof raw.name === 'string' && raw.name ? raw.name : '',
    default: fallback,
    images,
    talk:
      typeof raw.talk === 'string' && raw.talk
        ? new URL(raw.talk, manifestUrl).toString()
        : undefined,
    idleEmotions,
    idleInterval,
  }
}

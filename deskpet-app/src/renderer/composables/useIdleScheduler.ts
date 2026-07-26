import { MotionLayer } from './useMotionPriority'

const IDLE_TIMEOUT_MS = 25_000
const IDLE_INTERVAL_MIN_MS = 18_000
const IDLE_INTERVAL_MAX_MS = 45_000

/** 组名里出现这些词就当作待机动作 */
const IDLE_GROUP_PATTERN = /idle|neutral|no?rmal|stand|wait/i

/**
 * 从模型实际拥有的 motion 组里挑待机组。
 * 以前这里写死 ['Idle','idle','Neutral','Nomal'] 并随机取一个，
 * hiyori 只有 Idle，所以四次里三次是空放；没有 motion 的模型则全是空放。
 */
export function pickIdleGroups(available: string[]): string[] {
  return available.filter((group) => IDLE_GROUP_PATTERN.test(group))
}

export function useIdleScheduler(
  playMotionWithPriority: (motion: string, layer: MotionLayer, index?: number) => boolean,
  getIdleGroups: () => string[],
) {
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let schedulerRunning = false

  function scheduleNext() {
    if (!schedulerRunning) return
    clearIdleTimer()

    const delay = IDLE_INTERVAL_MIN_MS + Math.random() * (IDLE_INTERVAL_MAX_MS - IDLE_INTERVAL_MIN_MS)
    idleTimer = setTimeout(() => {
      const groups = getIdleGroups()
      if (groups.length > 0) {
        const group = groups[Math.floor(Math.random() * groups.length)]
        playMotionWithPriority(group, MotionLayer.Idle)
      }
      scheduleNext()
    }, delay)
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  function notifyInteraction() {
    clearIdleTimer()
    if (schedulerRunning) {
      idleTimer = setTimeout(scheduleNext, IDLE_TIMEOUT_MS)
    }
  }

  function start() {
    schedulerRunning = true
    clearIdleTimer()
    idleTimer = setTimeout(scheduleNext, IDLE_TIMEOUT_MS)
  }

  function stop() {
    schedulerRunning = false
    clearIdleTimer()
  }

  return { start, stop, notifyInteraction }
}

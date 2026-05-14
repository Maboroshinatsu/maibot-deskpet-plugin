import { MotionLayer } from './useMotionPriority'

const IDLE_TIMEOUT_MS = 25_000
const IDLE_INTERVAL_MIN_MS = 18_000
const IDLE_INTERVAL_MAX_MS = 45_000
const IDLE_MOTIONS = ['Idle', 'idle', 'Neutral', 'Nomal']

export function useIdleScheduler(
  playMotionWithPriority: (motion: string, layer: MotionLayer, index?: number) => boolean,
) {
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let schedulerRunning = false

  function pickIdleMotion(): string {
    return IDLE_MOTIONS[Math.floor(Math.random() * IDLE_MOTIONS.length)]
  }

  function scheduleNext() {
    if (!schedulerRunning) return
    clearIdleTimer()

    const delay = IDLE_INTERVAL_MIN_MS + Math.random() * (IDLE_INTERVAL_MAX_MS - IDLE_INTERVAL_MIN_MS)
    idleTimer = setTimeout(() => {
      playMotionWithPriority(pickIdleMotion(), MotionLayer.Idle)
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
    idleTimer = setTimeout(scheduleNext, IDLE_TIMEOUT_MS)
  }

  function stop() {
    schedulerRunning = false
    clearIdleTimer()
  }

  return { start, stop, notifyInteraction }
}

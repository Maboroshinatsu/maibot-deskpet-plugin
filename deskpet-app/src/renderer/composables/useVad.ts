/**
 * 简易能量 VAD
 *
 * 两个此前的坑：
 *   1. 用帧计数换算时间（silenceFrames / 40），而 requestAnimationFrame 实际约 60fps，
 *      导致「静音判定秒数」实际只有设定值的 2/3。现在直接用 performance.now() 计时。
 *   2. requestAnimationFrame 在窗口被隐藏/遮挡时会被节流甚至暂停，VAD 直接停摆。
 *      改用 setInterval，桌宠隐藏时也能继续听。
 */

interface VadCallbacks {
  onSpeechStart: () => void
  onSpeechEnd: () => void
  /** 返回 false 时本次采样直接丢弃（例如桌宠正在说话，避免听到自己） */
  shouldListen?: () => boolean
  /**
   * 进入抑制状态（shouldListen 变 false）时触发一次。
   * 调用方必须在这里取消进行中的录音：抑制只是停掉 VAD 检测，
   * 已经开录的 MediaRecorder 不取消的话会把桌宠自己的 TTS 录进去
   */
  onSuppress?: () => void
}

const TICK_INTERVAL_MS = 25
const SPEECH_START_MS = 200

export function useVad() {
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let ownedStream: MediaStream | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  // 复用同一个采样缓冲区，避免每个 tick 都分配（类型由赋值推断，兼容不同 TS lib 版本）
  let sampleBuffer = new Uint8Array(0)

  let threshold = 0.02
  let silenceTimeoutSec = 1.5
  let callbacks: VadCallbacks | null = null
  let speaking = false
  let suppressed = false
  let speechStartedAt = 0
  let silenceStartedAt = 0

  function setThreshold(v: number) { threshold = v }
  function setSilenceTimeout(s: number) { silenceTimeoutSec = s }
  function isRunning(): boolean { return timer !== null }

  /**
   * @param stream 复用调用方已有的麦克风流；不传则自己申请一路。
   *               复用可以避免 VAD 与录音各开一路 getUserMedia。
   */
  async function start(cb: VadCallbacks, stream?: MediaStream) {
    if (timer) return
    callbacks = cb

    if (stream) {
      ownedStream = null
    } else {
      ownedStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    }
    const source = stream ?? ownedStream!

    audioCtx = new AudioContext()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.3
    audioCtx.createMediaStreamSource(source).connect(analyser)
    sampleBuffer = new Uint8Array(analyser.frequencyBinCount)

    speaking = false
    suppressed = false
    speechStartedAt = 0
    silenceStartedAt = 0
    timer = setInterval(tick, TICK_INTERVAL_MS)
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    speaking = false
    ownedStream?.getTracks().forEach((t) => t.stop())
    ownedStream = null
    audioCtx?.close()
    audioCtx = null
    analyser = null
    sampleBuffer = new Uint8Array(0)
    callbacks = null
  }

  function tick() {
    if (!analyser || sampleBuffer.length === 0) return

    // 桌宠自己在说话时清空状态并跳过，避免 TTS 声音被麦克风听回去形成自问自答
    if (callbacks?.shouldListen && !callbacks.shouldListen()) {
      speaking = false
      speechStartedAt = 0
      silenceStartedAt = 0
      if (!suppressed) {
        suppressed = true
        callbacks?.onSuppress?.()
      }
      return
    }
    suppressed = false

    analyser.getByteTimeDomainData(sampleBuffer)
    let sum = 0
    for (let i = 0; i < sampleBuffer.length; i++) {
      const v = (sampleBuffer[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / sampleBuffer.length)
    const now = performance.now()

    if (rms > threshold) {
      silenceStartedAt = 0
      if (!speechStartedAt) speechStartedAt = now
      if (!speaking && now - speechStartedAt >= SPEECH_START_MS) {
        speaking = true
        callbacks?.onSpeechStart()
      }
    } else {
      speechStartedAt = 0
      if (speaking) {
        if (!silenceStartedAt) silenceStartedAt = now
        if (now - silenceStartedAt >= silenceTimeoutSec * 1000) {
          speaking = false
          silenceStartedAt = 0
          callbacks?.onSpeechEnd()
        }
      }
    }
  }

  return { start, stop, setThreshold, setSilenceTimeout, isRunning }
}

/**
 * 唇形同步状态（Web Audio 实时音频包络驱动 + 多正弦波回退）
 *
 * 注意：这是**模块级单例**——useWebSocket（TTS 播放时 start/stop）与
 * DeskpetStage（每帧 getMouthOpen 渲染嘴型）刻意共享同一份状态。
 * 拆成每组件独立实例会导致「在播放但嘴不动」，改动时保持单例语义。
 */
let phase = 0
let speaking = false
let mouthValue = 0
const DECAY = 0.86

// Web Audio 实时包络分析状态（单例复用 AudioContext 与采样缓冲区，零每帧分配）
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let mediaSource: MediaElementAudioSourceNode | null = null
let activeAudio: HTMLAudioElement | null = null
let timeDomainBuf: Uint8Array<ArrayBuffer> | null = null
let freqDomainBuf: Uint8Array<ArrayBuffer> | null = null

/** 快攻慢退系数：字音起音迅速张嘴，停顿/收音平滑闭合 */
const ATTACK_RATE = 0.52
const RELEASE_RATE = 0.22
/** 静音门限：过滤句间底噪与换气极弱尾音，让停顿时嘴巴自然闭合 */
const NOISE_FLOOR = 0.015

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioCtx) {
    try {
      audioCtx = new Ctor()
    } catch {
      return null
    }
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

function detachAudioSource() {
  try {
    mediaSource?.disconnect()
  } catch { /* ignore */ }
  try {
    analyser?.disconnect()
  } catch { /* ignore */ }
  mediaSource = null
  analyser = null
  activeAudio = null
}

function attachAudioSource(audio: HTMLAudioElement) {
  detachAudioSource()
  const ctx = ensureAudioContext()
  if (!ctx) return
  try {
    const node = ctx.createAnalyser()
    node.fftSize = 256
    node.smoothingTimeConstant = 0.2
    const src = ctx.createMediaElementSource(audio)
    src.connect(node)
    node.connect(ctx.destination)
    analyser = node
    mediaSource = src
    activeAudio = audio
    if (!timeDomainBuf || timeDomainBuf.length !== node.fftSize) {
      timeDomainBuf = new Uint8Array(new ArrayBuffer(node.fftSize))
    }
    if (!freqDomainBuf || freqDomainBuf.length !== node.frequencyBinCount) {
      freqDomainBuf = new Uint8Array(new ArrayBuffer(node.frequencyBinCount))
    }
  } catch {
    detachAudioSource()
  }
}

function sampleRealAudioEnvelope(): number | null {
  if (!analyser || !activeAudio || !timeDomainBuf || !freqDomainBuf) return null
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {})
    return null
  }
  // 音频尚在缓冲或已暂停/结束时，不提前动嘴
  if (activeAudio.paused || activeAudio.ended) {
    return 0
  }

  analyser.getByteTimeDomainData(timeDomainBuf)
  let sumSq = 0
  const len = timeDomainBuf.length
  for (let i = 0; i < len; i++) {
    const centered = (timeDomainBuf[i] - 128) / 128
    sumSq += centered * centered
  }
  const rms = Math.sqrt(sumSq / len)

  // 采样人声元音主频段（约 170Hz ~ 2800Hz），增强说话字音的张合辨识度
  analyser.getByteFrequencyData(freqDomainBuf)
  const sampleRate = audioCtx?.sampleRate || 44100
  const binHz = sampleRate / analyser.fftSize
  const startBin = Math.max(1, Math.floor(170 / binHz))
  const endBin = Math.min(freqDomainBuf.length - 1, Math.ceil(2800 / binHz))
  let vowelSum = 0
  let vowelCount = 0
  for (let i = startBin; i <= endBin; i++) {
    vowelSum += freqDomainBuf[i] / 255
    vowelCount++
  }
  const vowelEnergy = vowelCount > 0 ? vowelSum / vowelCount : 0

  if (rms < NOISE_FLOOR && vowelEnergy < 0.04) {
    return 0
  }

  const normalizedRms = Math.min(1, Math.max(0, (rms - NOISE_FLOOR) * 4.8))
  const normalizedVowel = Math.min(1, vowelEnergy * 2.2)
  // 结合时域音量包络与元音能量，映射为 [0, 1] 的自然张嘴开度
  const target = Math.min(1, normalizedRms * 0.65 + normalizedVowel * 0.35)
  return Math.pow(target, 0.85)
}

export function useLipSync() {
  function start(audio?: HTMLAudioElement | null) {
    speaking = true
    if (audio) {
      attachAudioSource(audio)
    } else {
      detachAudioSource()
    }
  }

  function stop() {
    speaking = false
    detachAudioSource()
  }

  function getMouthOpen(): number {
    if (speaking) {
      const realTarget = sampleRealAudioEnvelope()
      if (realTarget !== null) {
        const rate = realTarget > mouthValue ? ATTACK_RATE : RELEASE_RATE
        mouthValue += (realTarget - mouthValue) * rate
        if (mouthValue < 0.002) mouthValue = 0
        return mouthValue
      }
      // 无 Web Audio 或未传入 HTMLAudioElement 时回退到多正弦波模拟
      phase += 0.18
      const sim = Math.abs(
        0.4 * Math.sin(phase * 2.5) + 0.3 * Math.sin(phase * 1.8) + 0.3 * Math.sin(phase * 3.3),
      )
      const rate = sim > mouthValue ? ATTACK_RATE : RELEASE_RATE
      mouthValue += (sim - mouthValue) * rate
    } else {
      mouthValue *= DECAY
      if (mouthValue < 0.001) mouthValue = 0
    }
    return mouthValue
  }

  return { start, stop, getMouthOpen }
}


<template>
  <div class="section">
    <div class="section-title">核心连接与热键</div>

    <!-- MaiBot 连通性（只读，由 WS 状态得出） -->
    <div class="svc-row">
      <span class="dot" :class="store.wsConnected ? 'dot-running' : 'dot-stopped'" />
      <div class="svc-main">
        <div class="svc-name">MaiBot 插件<span class="svc-port">:{{ maibotPort }}</span></div>
        <div class="svc-detail">{{ store.wsConnected ? '已连接' : '未连接（请启动 MaiBot）' }}</div>
      </div>
    </div>

    <!-- 常驻：PTT 全局热键 -->
    <div v-for="svc in coreServices" :key="svc.id" class="svc-block">
      <div class="svc-row">
        <span class="dot" :class="dotClass(svc)" />
        <div class="svc-main">
          <div class="svc-name">{{ svc.name }}<span v-if="svc.port" class="svc-port">:{{ svc.port }}</span></div>
          <div class="svc-detail" :class="{ 'svc-error': svc.status === 'error' }">
            {{ statusText(svc) }}
          </div>
        </div>
        <div class="svc-actions">
          <button
            v-if="(svc.status === 'stopped' || svc.status === 'error') && svc.pid === null"
            class="btn btn-sm" :disabled="!svc.available"
            @click="startService(svc.id)"
          >启动</button>
          <template v-else>
            <button class="btn btn-sm" @click="stopService(svc.id)">停止</button>
            <button class="btn btn-sm" @click="restartService(svc.id)">重启</button>
          </template>
          <button
            v-if="openLogs.has(svc.id) || svc.status === 'error'"
            class="btn btn-sm btn-ghost"
            @click="copyLog(svc)"
          >
            {{ copiedMap[svc.id] ? '已复制' : '复制' }}
          </button>
          <button class="btn btn-sm btn-ghost" @click="toggleLog(svc.id)">
            {{ openLogs.has(svc.id) ? '收起' : '日志' }}
          </button>
        </div>
      </div>

      <div class="svc-opts">
        <label class="opt">
          <input type="checkbox" :checked="svc.autoStart" @change="setAutoStart(svc.id, $event)" />
          随桌宠自启
        </label>
      </div>

      <div v-if="openLogs.has(svc.id)" class="svc-log" :ref="(el) => setLogRef(svc.id, el)">
        <template v-if="(logsMap[svc.id] ?? []).length === 0">
          <div class="log-line log-muted">暂无日志</div>
        </template>
        <div v-else class="log-line" v-for="(line, i) in logsMap[svc.id]" :key="i">{{ line }}</div>
      </div>
    </div>

    <!-- 模块 1：语音识别（STT） -->
    <div class="mode-group">
      <div class="mode-head">
        <span class="mode-title">语音识别（STT）</span>
        <select class="mode-select" :value="config?.sttBackend ?? ''" @change="setSttBackend($event)">
          <option value="siliconflow">云端 · 硅基流动 SenseVoice（免费推荐）</option>
          <option value="dashscope">云端 · 阿里云百炼 Qwen-ASR</option>
          <option value="groq">云端 · Groq Whisper-v3-Turbo</option>
          <option value="openai">云端 · 自定义 OpenAI 兼容</option>
          <option value="">本地 · SenseVoice INT8（226MB 按需安装）</option>
        </select>
      </div>

      <!-- 云端 STT 配置（不显示本地 stt-bridge 进程卡片） -->
      <div v-if="config?.sttBackend" class="mode-body">
        <div class="svc-row cloud-direct-row">
          <span class="dot" :class="hasSttCredential ? 'dot-running' : 'dot-starting'" />
          <div class="svc-main">
            <div class="svc-name">云端 STT 直连</div>
            <div class="svc-detail">
              {{ hasSttCredential ? '已就绪（0 本地内存占用，无需启动本地桥）' : '请填写下方 API Key 后即可使用' }}
            </div>
          </div>
        </div>
        <label class="field-label">API Key</label>
        <input
          class="field-input"
          type="password"
          autocomplete="off"
          :value="config?.sttApiKey ?? ''"
          @change="setSttApiKey($event)"
          placeholder="sk-...（硅基流动 / 百炼 / Groq / OpenAI Key）"
        />
        <details class="svc-sub-config">
          <summary>高级参数（自定义模型名 / 端点）</summary>
          <label class="field-label">模型名称（留空使用平台推荐模型）</label>
          <input
            class="field-input"
            :value="config?.sttModel ?? ''"
            @change="setSttModel($event)"
            placeholder="FunAudioLLM/SenseVoiceSmall / qwen-audio-asr / whisper-large-v3-turbo"
          />
          <template v-if="config?.sttBackend === 'openai'">
            <label class="field-label">自定义 ASR 端点地址</label>
            <input
              class="field-input"
              :value="config?.sttEndpoint ?? ''"
              @change="setSttEndpoint($event)"
              placeholder="https://api.openai.com/v1/audio/transcriptions"
            />
          </template>
        </details>
      </div>

      <!-- 本地 STT 模式：仅在此模式下显示 stt-bridge 进程卡片 -->
      <div v-else class="mode-body">
        <div v-for="svc in sttLocalServices" :key="svc.id" class="svc-block no-top-border">
          <div class="svc-row">
            <span class="dot" :class="dotClass(svc)" />
            <div class="svc-main">
              <div class="svc-name">{{ svc.name }}<span v-if="svc.port" class="svc-port">:{{ svc.port }}</span></div>
              <div class="svc-detail" :class="{ 'svc-error': svc.status === 'error' }">
                {{ statusText(svc) }}
              </div>
            </div>
            <div class="svc-actions">
              <button
                v-if="(svc.status === 'stopped' || svc.status === 'error') && svc.pid === null"
                class="btn btn-sm" :disabled="!svc.available"
                @click="startService(svc.id)"
              >启动</button>
              <template v-else>
                <button class="btn btn-sm" @click="stopService(svc.id)">停止</button>
                <button class="btn btn-sm" @click="restartService(svc.id)">重启</button>
              </template>
              <button
                v-if="openLogs.has(svc.id) || svc.status === 'error'"
                class="btn btn-sm btn-ghost"
                @click="copyLog(svc)"
              >
                {{ copiedMap[svc.id] ? '已复制' : '复制' }}
              </button>
              <button class="btn btn-sm btn-ghost" @click="toggleLog(svc.id)">
                {{ openLogs.has(svc.id) ? '收起' : '日志' }}
              </button>
            </div>
          </div>

          <div class="svc-opts">
            <label class="opt">
              <input type="checkbox" :checked="svc.autoStart" @change="setAutoStart(svc.id, $event)" />
              随桌宠自启
            </label>
            <label class="opt">
              <input type="checkbox" :checked="svc.showTerminal" @change="setShowTerminal(svc.id, $event)" />
              终端窗口
            </label>
          </div>

          <div v-if="openLogs.has(svc.id)" class="svc-log" :ref="(el) => setLogRef(svc.id, el)">
            <template v-if="svc.showTerminal && svc.status !== 'stopped'">
              <div class="log-line log-muted">终端窗口模式下日志显示在独立窗口里</div>
            </template>
            <template v-else-if="(logsMap[svc.id] ?? []).length === 0">
              <div class="log-line log-muted">暂无日志</div>
            </template>
            <div v-else class="log-line" v-for="(line, i) in logsMap[svc.id]" :key="i">{{ line }}</div>
          </div>
        </div>
        <p class="hint">首次识别时若本地未缓存模型，将自动从国内镜像按需下载 INT8 量化模型（~226MB）</p>
      </div>
    </div>

    <!-- 模块 2：语音合成（TTS） -->
    <div class="mode-group">
      <div class="mode-head">
        <span class="mode-title">语音合成（TTS）</span>
        <select class="mode-select" :value="config?.ttsBackend ?? ''" @change="setTtsBackend($event)">
          <option value="off">未启用（不由桌宠托管 TTS）</option>
          <option value="siliconflow">云端 · 硅基流动 CosyVoice2 / IndexTTS</option>
          <option value="cosyvoice">云端 · 阿里云百炼 CosyVoice</option>
          <option value="mimo">云端 · 小米 MiMo TTS</option>
          <option value="fishaudio">云端 · Fish Audio</option>
          <option value="gsv2p">云端 · GSV2P（在线 GPT-SoVITS）</option>
          <option value="openai">云端 · 自定义第三方兼容（/v1/audio/speech）</option>
          <option value="">本地 · GPT-SoVITS 整合包</option>
        </select>
      </div>

      <!-- 云端 TTS 模式：仅显示云 TTS 桥 (9882) 与云端配置 -->
      <div v-if="isCloudTtsMode" class="mode-body">
        <div v-for="svc in ttsCloudServices" :key="svc.id" class="svc-block no-top-border">
          <div class="svc-row">
            <span class="dot" :class="dotClass(svc)" />
            <div class="svc-main">
              <div class="svc-name">{{ svc.name }}<span v-if="svc.port" class="svc-port">:{{ svc.port }}</span></div>
              <div class="svc-detail" :class="{ 'svc-error': svc.status === 'error' }">
                {{ statusText(svc) }}
              </div>
            </div>
            <div class="svc-actions">
              <button
                v-if="(svc.status === 'stopped' || svc.status === 'error') && svc.pid === null"
                class="btn btn-sm" :disabled="!svc.available"
                @click="startService(svc.id)"
              >启动</button>
              <template v-else>
                <button class="btn btn-sm" @click="stopService(svc.id)">停止</button>
                <button class="btn btn-sm" @click="restartService(svc.id)">重启</button>
              </template>
              <button
                v-if="openLogs.has(svc.id) || svc.status === 'error'"
                class="btn btn-sm btn-ghost"
                @click="copyLog(svc)"
              >
                {{ copiedMap[svc.id] ? '已复制' : '复制' }}
              </button>
              <button class="btn btn-sm btn-ghost" @click="toggleLog(svc.id)">
                {{ openLogs.has(svc.id) ? '收起' : '日志' }}
              </button>
            </div>
          </div>

          <div class="svc-opts">
            <label class="opt">
              <input type="checkbox" :checked="svc.autoStart" @change="setAutoStart(svc.id, $event)" />
              随桌宠自启
            </label>
            <label class="opt">
              <input type="checkbox" :checked="svc.showTerminal" @change="setShowTerminal(svc.id, $event)" />
              终端窗口
            </label>
          </div>

          <div v-if="openLogs.has(svc.id)" class="svc-log" :ref="(el) => setLogRef(svc.id, el)">
            <template v-if="svc.showTerminal && svc.status !== 'stopped'">
              <div class="log-line log-muted">终端窗口模式下日志显示在独立窗口里</div>
            </template>
            <template v-else-if="(logsMap[svc.id] ?? []).length === 0">
              <div class="log-line log-muted">暂无日志</div>
            </template>
            <div v-else class="log-line" v-for="(line, i) in logsMap[svc.id]" :key="i">{{ line }}</div>
          </div>
        </div>

        <label class="field-label">API Key / Token</label>
        <input
          class="field-input"
          type="password"
          autocomplete="off"
          :value="config?.ttsApiKey ?? ''"
          @change="setTtsApiKey($event)"
          placeholder="sk-... / Bearer Key / Token"
        />
        <label class="field-label">音色 / Reference ID（留空用默认音色）</label>
        <input
          class="field-input"
          :value="config?.ttsVoice ?? ''"
          @change="setTtsVoice($event)"
          placeholder="claire / cherry / mimo_default / 原神-中文-派蒙_ZH / nova"
        />
        <template v-if="config?.ttsBackend === 'mimo'">
          <label class="field-label">风格指令（可选，MiMo）</label>
          <input
            class="field-input"
            :value="config?.ttsStyle ?? ''"
            @change="setTtsStyle($event)"
            placeholder="例如：轻快、略带笑意，语速稍快（voicedesign 模型必填）"
          />
        </template>
        <template v-if="config?.ttsBackend === 'openai'">
          <label class="field-label">自定义 TTS 端点地址</label>
          <input
            class="field-input"
            :value="config?.ttsEndpoint ?? ''"
            @change="setTtsEndpoint($event)"
            placeholder="https://api.openai.com/v1/audio/speech"
          />
          <label class="field-label">模型名称（留空默认 tts-1）</label>
          <input
            class="field-input"
            :value="config?.ttsModel ?? ''"
            @change="setTtsModel($event)"
            placeholder="tts-1 / gpt-4o-mini-tts / FunAudioLLM/CosyVoice2-0.5B"
          />
        </template>
        <details v-else class="svc-sub-config">
          <summary>高级参数（自定义模型名 / 端点）</summary>
          <label class="field-label">模型名称（留空使用对应平台默认模型）</label>
          <input
            class="field-input"
            :value="config?.ttsModel ?? ''"
            @change="setTtsModel($event)"
            placeholder="FunAudioLLM/CosyVoice2-0.5B / qwen-audio-3.0-tts-flash"
          />
          <label class="field-label">自定义端点地址（留空使用官方默认地址）</label>
          <input
            class="field-input"
            :value="config?.ttsEndpoint ?? ''"
            @change="setTtsEndpoint($event)"
            placeholder="https://..."
          />
        </details>
        <p class="hint">
          {{ cloudTtsRunning
            ? '云 TTS 桥 (9882) 运行中：桌宠收到回复后会自行合成并播放语音'
            : '启动后，桌宠收到回复会自动用本机云 TTS 桥 (9882) 合成并播放语音' }}
        </p>
      </div>

      <!-- 本地 GPT-SoVITS 模式：仅显示本地 TTS 桥 (9881) 与 GPT-SoVITS (9880) -->
      <div v-else-if="isLocalTtsMode" class="mode-body">
        <div
          v-for="(svc, idx) in ttsLocalServices"
          :key="svc.id"
          class="svc-block"
          :class="{ 'no-top-border': idx === 0 }"
        >
          <div class="svc-row">
            <span class="dot" :class="dotClass(svc)" />
            <div class="svc-main">
              <div class="svc-name">{{ svc.name }}<span v-if="svc.port" class="svc-port">:{{ svc.port }}</span></div>
              <div class="svc-detail" :class="{ 'svc-error': svc.status === 'error' }">
                {{ statusText(svc) }}
              </div>
            </div>
            <div class="svc-actions">
              <button
                v-if="(svc.status === 'stopped' || svc.status === 'error') && svc.pid === null"
                class="btn btn-sm" :disabled="!svc.available"
                @click="startService(svc.id)"
              >启动</button>
              <template v-else>
                <button class="btn btn-sm" @click="stopService(svc.id)">停止</button>
                <button class="btn btn-sm" @click="restartService(svc.id)">重启</button>
              </template>
              <button
                v-if="openLogs.has(svc.id) || svc.status === 'error'"
                class="btn btn-sm btn-ghost"
                @click="copyLog(svc)"
              >
                {{ copiedMap[svc.id] ? '已复制' : '复制' }}
              </button>
              <button class="btn btn-sm btn-ghost" @click="toggleLog(svc.id)">
                {{ openLogs.has(svc.id) ? '收起' : '日志' }}
              </button>
            </div>
          </div>

          <div class="svc-opts">
            <label class="opt">
              <input type="checkbox" :checked="svc.autoStart" @change="setAutoStart(svc.id, $event)" />
              随桌宠自启
            </label>
            <label class="opt">
              <input type="checkbox" :checked="svc.showTerminal" @change="setShowTerminal(svc.id, $event)" />
              终端窗口
            </label>
          </div>

          <div v-if="openLogs.has(svc.id)" class="svc-log" :ref="(el) => setLogRef(svc.id, el)">
            <template v-if="svc.showTerminal && svc.status !== 'stopped'">
              <div class="log-line log-muted">终端窗口模式下日志显示在独立窗口里</div>
            </template>
            <template v-else-if="(logsMap[svc.id] ?? []).length === 0">
              <div class="log-line log-muted">暂无日志</div>
            </template>
            <div v-else class="log-line" v-for="(line, i) in logsMap[svc.id]" :key="i">{{ line }}</div>
          </div>
        </div>

        <details class="svc-sub-config">
          <summary>GPT-SoVITS 目录与参考音频配置</summary>
          <label class="field-label">GPT-SoVITS 整合包目录（留空自动探测）</label>
          <input class="field-input" :value="config?.gsvDir ?? ''" @change="setGsvDir($event)" placeholder="D:\GPT-SoVITS-v2pro-xxxx" />
          <label class="field-label">参考音频（角色声线 .wav）</label>
          <input class="field-input" :value="config?.ttsRefAudio ?? ''" @change="setTtsRefAudio($event)" placeholder="D:\...\角色参考音频.wav" />
          <label class="field-label">参考音频文本（这段音频里说的话）</label>
          <input class="field-input" :value="config?.ttsPromptText ?? ''" @change="setTtsPromptText($event)" placeholder="参考音频里说的文本内容" />
        </details>
      </div>
    </div>

    <!-- 底部折叠：Python 解释器环境（仅当有待确认候选或用户需要手动指定时展开） -->
    <details class="svc-config" :open="!!runtimeCandidate">
      <summary>Python 解释器环境（高级）</summary>
      <label class="field-label">Python 路径（显式指定优先；自动发现需确认；否则使用系统 PATH）</label>
      <input class="field-input" :value="config?.pythonPath ?? ''" @change="setPythonPath($event)" placeholder="留空即可" />

      <div v-if="runtimeCandidate || candidateFeedback" class="candidate">
        <template v-if="runtimeCandidate">
          <div class="candidate-title">MaiBot 上报的本机 Python 候选</div>
          <div class="candidate-row">来源：{{ runtimeCandidate.sourceUrl }}</div>
          <div class="candidate-row">路径：{{ runtimeCandidate.pythonPath }}</div>
          <p class="hint">该解释器尚未用于启动，需在本机确认后才会启用</p>
          <div class="candidate-actions">
            <button class="btn btn-sm" :disabled="candidatePending" @click="approveCandidate">
              {{ candidatePending ? '等待本机确认…' : '审核并使用此解释器' }}
            </button>
          </div>
        </template>
        <div
          v-if="candidateFeedback"
          class="candidate-feedback"
          :class="{ 'candidate-feedback-error': candidateFeedbackError }"
        >{{ candidateFeedback }}</div>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'

const store = useDeskpetStore()

function readMaibotPort(): string {
  try {
    const raw = localStorage.getItem('deskpet/ws-url') || 'ws://127.0.0.1:8523/ws'
    return new URL(raw).port || '8523'
  } catch {
    return '8523'
  }
}

const maibotPort = ref(readMaibotPort())
function onWsConfigChanged() {
  maibotPort.value = readMaibotPort()
}

const services = ref<ServiceState[]>([])
const config = ref<ServicesConfig | null>(null)
const logsMap = reactive<Partial<Record<ServiceId, string[]>>>({})
const openLogs = reactive(new Set<ServiceId>())
const copiedMap = reactive<Partial<Record<ServiceId, boolean>>>({})
const copyTimers = new Map<ServiceId, ReturnType<typeof setTimeout>>()
const logRefs = new Map<ServiceId, HTMLElement>()

const coreServices = computed(() =>
  services.value.filter((svc) => svc.id === 'hotkey'),
)
const sttLocalServices = computed(() =>
  services.value.filter((svc) => svc.id === 'stt-bridge'),
)
const ttsCloudServices = computed(() =>
  services.value.filter((svc) => svc.id === 'cloud-tts'),
)
const ttsLocalServices = computed(() =>
  services.value.filter((svc) => svc.id === 'tts-bridge' || svc.id === 'gpt-sovits'),
)

const CLOUD_TTS_BACKENDS = new Set(['siliconflow', 'cosyvoice', 'mimo', 'fishaudio', 'gsv2p', 'openai'])

const isCloudTtsMode = computed(() => {
  const b = (config.value?.ttsBackend ?? '').toLowerCase()
  return CLOUD_TTS_BACKENDS.has(b)
})
const isLocalTtsMode = computed(() => {
  const b = config.value?.ttsBackend ?? ''
  return b === '' || b === 'local'
})
const cloudTtsRunning = computed(() =>
  services.value.some((svc) => svc.id === 'cloud-tts' && svc.status === 'running'),
)
const hasSttCredential = computed(() => {
  const b = config.value?.sttBackend ?? ''
  if (!b) return false
  if (b === 'openai') return true
  if (config.value?.sttApiKey) return true
  if (b === 'dashscope' && config.value?.ttsBackend === 'cosyvoice' && config.value?.ttsApiKey) {
    return true
  }
  return false
})

const runtimeCandidate = ref<{ id: string; pythonPath: string; sourceUrl: string } | null>(null)
const candidatePending = ref(false)
const candidateFeedback = ref('')
const candidateFeedbackError = ref(false)
let candidateSeq = 0

let unsubUpdate: (() => void) | null = null
let unsubLog: (() => void) | null = null

function setLogRef(id: ServiceId, el: unknown) {
  if (el instanceof HTMLElement) logRefs.set(id, el)
}

function scrollLogToEnd(id: ServiceId) {
  void nextTick(() => {
    const el = logRefs.get(id)
    if (el) el.scrollTop = el.scrollHeight
  })
}

function dotClass(svc: ServiceState): string {
  if (!svc.available) return 'dot-stopped'
  switch (svc.status) {
    case 'running': return 'dot-running'
    case 'starting': return 'dot-starting'
    case 'error': return 'dot-error'
    default: return 'dot-stopped'
  }
}

function statusText(svc: ServiceState): string {
  if (!svc.available) return svc.detail
  switch (svc.status) {
    case 'running': return `运行中 (pid ${svc.pid})`
    case 'starting': return '启动中…'
    case 'error': return svc.detail || '出错了'
    default: return svc.detail || '已停止'
  }
}

async function refresh() {
  services.value = (await window.electronAPI?.listServices()) ?? []
  config.value = (await window.electronAPI?.getServicesConfig()) ?? null
  void refreshCandidate()
}

async function refreshCandidate() {
  const seq = ++candidateSeq
  try {
    const next = (await window.electronAPI?.getRuntimeCandidate()) ?? null
    if (seq !== candidateSeq) return
    const previousId = runtimeCandidate.value?.id ?? null
    runtimeCandidate.value = next
    if (next && next.id !== previousId) {
      candidateFeedback.value = ''
      candidateFeedbackError.value = false
    }
  } catch {
    // ignore
  }
}

async function approveCandidate() {
  const candidate = runtimeCandidate.value
  if (!candidate || candidatePending.value) return
  if (!window.electronAPI?.approveDetectedPython) {
    candidateFeedbackError.value = true
    candidateFeedback.value = '确认失败：当前版本不支持本机确认'
    return
  }
  candidatePending.value = true
  candidateFeedback.value = ''
  candidateFeedbackError.value = false
  try {
    const approved = await window.electronAPI.approveDetectedPython(candidate.id)
    if (approved) {
      candidateFeedback.value = '已确认，后续启动将使用该解释器'
    } else {
      candidateFeedbackError.value = true
      candidateFeedback.value = '未确认，该解释器不会被使用'
    }
  } catch (e) {
    candidateFeedbackError.value = true
    candidateFeedback.value = `确认失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    candidatePending.value = false
    void refreshCandidate()
  }
}

function startService(id: ServiceId) { void window.electronAPI?.startService(id) }
function stopService(id: ServiceId) { void window.electronAPI?.stopService(id) }
function restartService(id: ServiceId) { void window.electronAPI?.restartService(id) }

async function toggleLog(id: ServiceId) {
  if (openLogs.has(id)) {
    openLogs.delete(id)
    return
  }
  logsMap[id] = (await window.electronAPI?.getServiceLogs(id)) ?? []
  openLogs.add(id)
  scrollLogToEnd(id)
}

async function copyLog(svc: ServiceState) {
  const id = svc.id
  const lines = logsMap[id] ?? (await window.electronAPI?.getServiceLogs(id)) ?? []
  logsMap[id] = lines
  const header = `[${svc.name}] 状态: ${statusText(svc)}`
  const text = lines.length > 0 ? `${header}\n${lines.join('\n')}` : header
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copiedMap[id] = true
  const prev = copyTimers.get(id)
  if (prev) clearTimeout(prev)
  copyTimers.set(
    id,
    setTimeout(() => {
      copiedMap[id] = false
      copyTimers.delete(id)
    }, 1800),
  )
}

function setAutoStart(id: ServiceId, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  void window.electronAPI?.setServicesConfig({ autoStart: { [id]: checked } as Record<ServiceId, boolean> })
}

function setShowTerminal(id: ServiceId, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  void window.electronAPI?.setServicesConfig({ showTerminal: { [id]: checked } as Record<ServiceId, boolean> })
}

function setPythonPath(e: Event) {
  void window.electronAPI?.setServicesConfig({ pythonPath: (e.target as HTMLInputElement).value.trim() })
}

function setGsvDir(e: Event) {
  void window.electronAPI?.setServicesConfig({ gsvDir: (e.target as HTMLInputElement).value.trim() })
}

function setTtsRefAudio(e: Event) {
  void window.electronAPI?.setServicesConfig({ ttsRefAudio: (e.target as HTMLInputElement).value.trim() })
}

function setTtsPromptText(e: Event) {
  void window.electronAPI?.setServicesConfig({ ttsPromptText: (e.target as HTMLInputElement).value.trim() })
}

async function setSttBackend(e: Event) {
  const sttBackend = (e.target as HTMLSelectElement).value.trim()
  if (sttBackend) {
    // 切换到云端直连时，自动停掉并不再自启本地 stt-bridge
    void window.electronAPI?.stopService('stt-bridge')
    const next = await window.electronAPI?.setServicesConfig({
      sttBackend,
      autoStart: { 'stt-bridge': false } as Record<ServiceId, boolean>,
    })
    if (next) config.value = next
  } else {
    const next = await window.electronAPI?.setServicesConfig({ sttBackend: '' })
    if (next) config.value = next
  }
}

async function setSttApiKey(e: Event) {
  const next = await window.electronAPI?.setServicesConfig({ sttApiKey: (e.target as HTMLInputElement).value.trim() })
  if (next) config.value = next
}

async function setSttModel(e: Event) {
  const next = await window.electronAPI?.setServicesConfig({ sttModel: (e.target as HTMLInputElement).value.trim() })
  if (next) config.value = next
}

async function setSttEndpoint(e: Event) {
  const next = await window.electronAPI?.setServicesConfig({ sttEndpoint: (e.target as HTMLInputElement).value.trim() })
  if (next) config.value = next
}

async function setTtsBackend(e: Event) {
  const ttsBackend = (e.target as HTMLSelectElement).value.trim()
  if (ttsBackend === 'off') {
    void window.electronAPI?.stopService('cloud-tts')
    void window.electronAPI?.stopService('tts-bridge')
    void window.electronAPI?.stopService('gpt-sovits')
    const next = await window.electronAPI?.setServicesConfig({
      ttsBackend,
      autoStart: {
        'cloud-tts': false,
        'tts-bridge': false,
        'gpt-sovits': false,
      } as Record<ServiceId, boolean>,
    })
    if (next) config.value = next
  } else if (CLOUD_TTS_BACKENDS.has(ttsBackend.toLowerCase())) {
    // 切换到云端 TTS 时，自动停掉本地 GPT-SoVITS 与本地 TTS 桥
    void window.electronAPI?.stopService('tts-bridge')
    void window.electronAPI?.stopService('gpt-sovits')
    const next = await window.electronAPI?.setServicesConfig({
      ttsBackend,
      autoStart: {
        'tts-bridge': false,
        'gpt-sovits': false,
      } as Record<ServiceId, boolean>,
    })
    if (next) config.value = next
  } else {
    // 切换回本地 GPT-SoVITS 时，停掉云 TTS 桥
    void window.electronAPI?.stopService('cloud-tts')
    const next = await window.electronAPI?.setServicesConfig({
      ttsBackend: '',
      autoStart: { 'cloud-tts': false } as Record<ServiceId, boolean>,
    })
    if (next) config.value = next
  }
}

async function setTtsApiKey(e: Event) {
  const next = await window.electronAPI?.setServicesConfig({ ttsApiKey: (e.target as HTMLInputElement).value.trim() })
  if (next) config.value = next
}

async function setTtsVoice(e: Event) {
  const next = await window.electronAPI?.setServicesConfig({ ttsVoice: (e.target as HTMLInputElement).value.trim() })
  if (next) config.value = next
}

async function setTtsModel(e: Event) {
  const next = await window.electronAPI?.setServicesConfig({ ttsModel: (e.target as HTMLInputElement).value.trim() })
  if (next) config.value = next
}

async function setTtsStyle(e: Event) {
  const next = await window.electronAPI?.setServicesConfig({ ttsStyle: (e.target as HTMLInputElement).value.trim() })
  if (next) config.value = next
}

async function setTtsEndpoint(e: Event) {
  const next = await window.electronAPI?.setServicesConfig({ ttsEndpoint: (e.target as HTMLInputElement).value.trim() })
  if (next) config.value = next
}

onMounted(() => {
  void refresh()
  window.addEventListener('deskpet:ws-config-changed', onWsConfigChanged)
  unsubUpdate = window.electronAPI?.onServicesUpdate((states) => {
    services.value = states
    void refreshCandidate()
  }) ?? null
  unsubLog = window.electronAPI?.onServiceLog(({ id, lines }) => {
    const buf = logsMap[id] ?? (logsMap[id] = [])
    buf.push(...lines)
    if (buf.length > 400) buf.splice(0, buf.length - 400)
    if (openLogs.has(id)) scrollLogToEnd(id)
  }) ?? null
})

onUnmounted(() => {
  candidateSeq++
  for (const timer of copyTimers.values()) clearTimeout(timer)
  copyTimers.clear()
  window.removeEventListener('deskpet:ws-config-changed', onWsConfigChanged)
  unsubUpdate?.()
  unsubLog?.()
})
</script>

<style scoped>
.section { display: flex; flex-direction: column; gap: 10px; }
.section-title {
  color: var(--dp-text-dim);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.svc-block { display: flex; flex-direction: column; gap: 5px; padding-top: 8px; border-top: 1px solid var(--dp-border); }
.svc-block.no-top-border { padding-top: 2px; border-top: none; }
.svc-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.svc-main { flex: 1; min-width: 0; }
.svc-name { color: var(--dp-text-main); font-size: 12px; font-weight: 700; }
.svc-port { color: var(--dp-text-sub); font-family: ui-monospace, Consolas, monospace; font-size: 11px; font-weight: 600; margin-left: 4px; }
.svc-detail {
  color: var(--dp-text-sub);
  font-size: 11px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.svc-error { color: #ef4444; white-space: normal; word-break: break-word; }
.svc-actions { display: flex; gap: 4px; flex-shrink: 0; }

.mode-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--dp-border);
}

.mode-head {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.mode-title {
  color: var(--dp-text-dim);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.mode-select {
  width: 100%;
  background: var(--dp-input-bg);
  border: 1px solid var(--dp-border);
  border-radius: 10px;
  padding: 6px 9px;
  color: var(--dp-text-main);
  font-size: 11.5px;
  font-weight: 600;
  outline: none;
  cursor: pointer;
}
.mode-select:focus {
  border-color: var(--dp-accent-border);
}

.mode-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cloud-direct-row {
  padding: 2px 0;
}

.field-label {
  color: var(--dp-text-sub);
  font-size: 11px;
  font-weight: 600;
  margin-top: 2px;
}

.field-input {
  width: 100%;
  background: var(--dp-input-bg);
  border: 1px solid var(--dp-border);
  border-radius: 10px;
  padding: 6px 10px;
  color: var(--dp-text-main);
  font-size: 11.5px;
  font-family: ui-monospace, Consolas, monospace;
  outline: none;
  box-sizing: border-box;
}
.field-input:focus {
  border-color: var(--dp-accent-border);
}

.svc-sub-config {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 2px;
}
.svc-sub-config summary {
  color: var(--dp-text-sub);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-running { background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.18); animation: breathe 3s ease-in-out infinite; }
.dot-starting { background: #f59e0b; animation: pulse 1s ease-in-out infinite; }
.dot-error { background: #ef4444; }
.dot-stopped { background: var(--dp-text-dim); }

@keyframes breathe {
  0%, 100% { box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.18); }
  50% { box-shadow: 0 0 0 5px rgba(52, 211, 153, 0.05); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.btn {
  padding: 5px 10px;
  border-radius: 10px;
  border: none;
  background: var(--dp-pill-inner);
  color: var(--dp-text-main);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease;
}
.btn:hover:not(:disabled) { background: var(--dp-card-hover); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-sm { padding: 4px 9px; font-size: 11px; font-weight: 600; }
.btn-ghost { background: transparent; color: var(--dp-text-sub); }
.btn-ghost:hover { color: var(--dp-text-main); background: var(--dp-card-hover); }

.svc-opts { display: flex; gap: 14px; padding-left: 16px; }
.opt { display: flex; align-items: center; gap: 5px; color: var(--dp-text-sub); font-size: 11px; font-weight: 600; cursor: pointer; }
.opt input { accent-color: var(--dp-accent); cursor: pointer; }

.svc-log {
  margin-left: 16px; max-height: 140px; overflow-y: auto;
  background: var(--dp-input-bg); border: none;
  border-radius: 10px; padding: 7px 9px;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.log-line {
  color: var(--dp-text-sub); font-family: ui-monospace, Consolas, monospace;
  font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-all;
  user-select: text;
  -webkit-user-select: text;
}
.log-muted { color: var(--dp-text-dim); }

.svc-config {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--dp-border);
}
.svc-config summary {
  color: var(--dp-text-sub);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}

.candidate {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--dp-accent-soft);
  border: 1px solid var(--dp-accent-border);
}
.candidate-title { color: var(--dp-text-main); font-size: 11.5px; font-weight: 700; }
.candidate-row {
  color: var(--dp-text-sub);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10.5px;
  word-break: break-all;
}
.candidate-actions { display: flex; gap: 6px; margin-top: 2px; }
.candidate-feedback { color: #10b981; font-size: 11px; font-weight: 600; }
.candidate-feedback-error { color: #ef4444; }

.hint { color: var(--dp-text-dim); font-size: 10.5px; margin: 2px 0 0; line-height: 1.45; }
</style>

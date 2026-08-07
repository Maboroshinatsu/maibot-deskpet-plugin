<template>
  <div class="section">
    <div class="section-title">后台服务</div>

    <!-- MaiBot 连通性（只读，由 WS 状态得出） -->
    <div class="svc-row">
      <span class="dot" :class="store.wsConnected ? 'dot-running' : 'dot-stopped'" />
      <div class="svc-main">
        <div class="svc-name">MaiBot 插件<span class="svc-port">:{{ maibotPort }}</span></div>
        <div class="svc-detail">{{ store.wsConnected ? '已连接' : '未连接（请启动 MaiBot）' }}</div>
      </div>
    </div>

    <div v-for="svc in services" :key="svc.id" class="svc-block">
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
            v-if="svc.status === 'stopped' || svc.status === 'error'"
            class="btn btn-sm" :disabled="!svc.available"
            @click="startService(svc.id)"
          >启动</button>
          <template v-else>
            <button class="btn btn-sm" @click="stopService(svc.id)">停止</button>
            <button class="btn btn-sm" @click="restartService(svc.id)">重启</button>
          </template>
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
        <label class="opt" :title="'开启后在独立终端窗口运行（重启该服务生效），日志不再进入下方面板'">
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

    <!-- 路径配置 -->
    <details class="svc-config">
      <summary>服务路径配置</summary>
      <label>Python 路径（留空复用 MaiBot 的 Python，未连接时用系统 PATH）</label>
      <input :value="config?.pythonPath ?? ''" @change="setPythonPath($event)" placeholder="留空即可" />
      <label>GPT-SoVITS 整合包目录（留空自动探测）</label>
      <input :value="config?.gsvDir ?? ''" @change="setGsvDir($event)" placeholder="D:\GPT-SoVITS-v2pro-xxxx" />
      <label>GPT-SoVITS 参考音频（角色声线 .wav）</label>
      <input :value="config?.ttsRefAudio ?? ''" @change="setTtsRefAudio($event)" placeholder="D:\...\角色参考音频.wav" />
      <label>参考音频文本（这段音频里说的话）</label>
      <input :value="config?.ttsPromptText ?? ''" @change="setTtsPromptText($event)" placeholder="参考音频里说的文本内容" />
      <p class="hint">修改后对下一次启动生效；运行中的服务需手动重启</p>
    </details>

    <!-- 云 TTS 配置 -->
    <details class="svc-config">
      <summary>云 TTS 配置（MiMo / CosyVoice / GSV2P）</summary>
      <label>云 TTS 后端</label>
      <select :value="config?.ttsBackend ?? ''" @change="setTtsBackend($event)">
        <option value="">（未启用）</option>
        <option value="mimo">小米 MiMo</option>
        <option value="cosyvoice">阿里云 CosyVoice</option>
        <option value="gsv2p">GSV2P（云端 GPT-SoVITS）</option>
      </select>
      <label>API Key / Token（后端对应的那把）</label>
      <input :value="config?.ttsApiKey ?? ''" @change="setTtsApiKey($event)" placeholder="sk-... / Bearer Key / Token" />
      <label>音色（留空用默认音色）</label>
      <input :value="config?.ttsVoice ?? ''" @change="setTtsVoice($event)" placeholder="mimo_default / cherry / 原神-中文-派蒙_ZH" />
      <p class="hint">配置后在「后台服务」里启动「云 TTS 桥」；把 TTS 桥地址指向 9882 即用云合成</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useDeskpetStore } from '@/stores/deskpet'

const store = useDeskpetStore()

/** MaiBot 插件端口跟随设置面板里的 WS 地址，不写死 */
const maibotPort = computed(() => {
  try {
    const raw = localStorage.getItem('deskpet/ws-url') || 'ws://127.0.0.1:8523/ws'
    return new URL(raw).port || '8523'
  } catch {
    return '8523'
  }
})

const services = ref<ServiceState[]>([])
const config = ref<ServicesConfig | null>(null)
const logsMap = reactive<Partial<Record<ServiceId, string[]>>>({})
const openLogs = reactive(new Set<ServiceId>())
const logRefs = new Map<ServiceId, HTMLElement>()

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

function setTtsBackend(e: Event) {
  void window.electronAPI?.setServicesConfig({ ttsBackend: (e.target as HTMLSelectElement).value.trim() })
}

function setTtsApiKey(e: Event) {
  void window.electronAPI?.setServicesConfig({ ttsApiKey: (e.target as HTMLInputElement).value.trim() })
}

function setTtsVoice(e: Event) {
  void window.electronAPI?.setServicesConfig({ ttsVoice: (e.target as HTMLInputElement).value.trim() })
}

onMounted(() => {
  void refresh()
  unsubUpdate = window.electronAPI?.onServicesUpdate((states) => {
    services.value = states
  }) ?? null
  unsubLog = window.electronAPI?.onServiceLog(({ id, lines }) => {
    const buf = logsMap[id] ?? (logsMap[id] = [])
    buf.push(...lines)
    if (buf.length > 400) buf.splice(0, buf.length - 400)
    if (openLogs.has(id)) scrollLogToEnd(id)
  }) ?? null
})

onUnmounted(() => {
  unsubUpdate?.()
  unsubLog?.()
})
</script>

<style scoped>
.section { display: flex; flex-direction: column; gap: 8px; }
.section-title { color: #999; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }

.svc-block { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
.svc-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.svc-main { flex: 1; min-width: 0; }
.svc-name { color: #ddd; font-size: 12px; }
.svc-port { color: #777; font-family: ui-monospace, Consolas, monospace; font-size: 11px; margin-left: 4px; }
.svc-detail { color: #888; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.svc-error { color: #e08e8e; white-space: normal; }
.svc-actions { display: flex; gap: 4px; flex-shrink: 0; }

.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-running { background: #4ec98f; box-shadow: 0 0 0 3px rgba(78, 201, 143, 0.15); animation: breathe 3s ease-in-out infinite; }
.dot-starting { background: #d9a94e; animation: pulse 1s ease-in-out infinite; }
.dot-error { background: #d96a6a; }
.dot-stopped { background: #555; }

@keyframes breathe {
  0%, 100% { box-shadow: 0 0 0 3px rgba(78, 201, 143, 0.15); }
  50% { box-shadow: 0 0 0 5px rgba(78, 201, 143, 0.05); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.btn {
  padding: 7px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.08); color: #ddd; font-size: 12px; cursor: pointer;
}
.btn:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-sm { padding: 3px 8px; font-size: 11px; }
.btn-ghost { background: transparent; border-color: transparent; color: #999; }
.btn-ghost:hover { color: #ddd; background: rgba(255,255,255,0.08); }

.svc-opts { display: flex; gap: 14px; padding-left: 16px; }
.opt { display: flex; align-items: center; gap: 4px; color: #999; font-size: 11px; cursor: pointer; }
.opt input { accent-color: #6d9bd1; cursor: pointer; }

.svc-log {
  margin-left: 16px; max-height: 140px; overflow-y: auto;
  background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px; padding: 6px 8px;
}
.log-line {
  color: #9fb0a5; font-family: ui-monospace, Consolas, monospace;
  font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all;
}
.log-muted { color: #666; }

.svc-config { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
.svc-config summary { color: #999; font-size: 11px; cursor: pointer; user-select: none; }
.svc-config label { color: #bbb; font-size: 12px; margin-top: 6px; display: block; }
.svc-config input {
  width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06); color: #eee; font-size: 12px; outline: none;
}
.svc-config input:focus { border-color: rgba(120, 160, 220, 0.6); }
.hint { color: #666; font-size: 11px; margin: 4px 0 0; }
</style>

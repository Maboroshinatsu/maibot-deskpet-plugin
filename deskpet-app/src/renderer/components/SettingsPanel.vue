<template>
  <Transition name="settings-slide">
    <div v-if="open" class="settings-overlay" @mousedown.stop>
      <div class="settings-panel">
        <div class="settings-header">
          <span>设置</span>
          <button class="settings-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="settings-body">
          <!-- 后台服务（一键启动的可视化） -->
          <ServicesSection />
          <!-- 连接 -->
          <div class="section">
            <div class="section-title">连接</div>
            <label>WS 地址</label>
            <input :value="wsUrl" @change="setWsUrl($event)" placeholder="ws://127.0.0.1:8523/ws" />
            <label>WS Token</label>
            <input :value="wsToken" @change="setWsToken($event)" placeholder="留空不验证" />
            <label>STT 地址</label>
            <input :value="sttUrl" @change="setSttUrl($event)" placeholder="http://127.0.0.1:18530/stt" />
            <p class="hint">修改后需重载生效</p>
            <button class="btn" @click="reload">重载应用（Ctrl+R / F5）</button>
          </div>
          <!-- 显示 -->
          <div class="section">
            <div class="section-title">显示</div>
            <div class="seg">
              <button class="seg-btn" :class="{ on: displayMode === 'live2d' }" @click="setDisplayMode('live2d')">Live2D</button>
              <button class="seg-btn" :class="{ on: displayMode === 'image-set' }" @click="setDisplayMode('image-set')">静态立绘</button>
            </div>
            <label>{{ displayMode === 'live2d' ? 'Live2D 模型' : '立绘包' }}</label>
            <select :value="selectedModel" @change="onModelChange($event)" :disabled="switching || filteredModels.length === 0">
              <option v-if="filteredModels.length === 0" value="">（该类型下没有模型）</option>
              <option v-for="m in filteredModels" :key="m.url" :value="m.url">{{ m.name }}</option>
            </select>
            <div class="row">
              <button class="btn" @click="rescan" :disabled="switching">重新扫描</button>
              <button class="btn" @click="openModelsFolder">打开模型目录</button>
              <span v-if="switching" class="hint">切换中…</span>
            </div>
            <p class="hint">切换后立即生效，无需重启</p>
            <p class="hint">自定义模型/立绘包放「用户模型目录」（userData/models，重装不丢）；安装目录里的 models 会被安装包清空</p>
          </div>
          <!-- 麦克风 -->
          <div class="section">
            <div class="section-title">麦克风</div>
            <label>VAD 灵敏度 (0.01~0.1，越小越灵敏)</label>
            <input type="number" :value="vadThreshold" @change="setVadThreshold($event)" min="0.005" max="0.1" step="0.005" placeholder="0.02" />
            <label>静音判定秒数</label>
            <input type="number" :value="vadSilence" @change="setVadSilence($event)" min="0.5" max="5" step="0.5" placeholder="1.5" />
            <p class="hint">修改后需重新开启麦克风生效</p>
            <label>全局 PTT 热键（非组合键）</label>
            <input :value="pttKey" @change="setPttKey($event)" placeholder="f9 / scroll_lock / pause / mouse4" />
            <label>热键模式</label>
            <select :value="pttMode" @change="setPttMode($event)">
              <option value="ptt">按住说话，松开发送</option>
              <option value="toggle">按一下开，再按一下关</option>
            </select>
            <p class="hint">改热键后到「后台服务」重启 PTT 热键桥生效；模式即时生效。VAD 开启时热键不生效</p>
          </div>
          <!-- 截图 -->
          <div class="section">
            <div class="section-title">截图</div>
            <p class="hint">托盘菜单 → 截图识图（手动）</p>
            <p class="hint">托盘菜单 → 自动截图（定期截屏发给 MaiBot）</p>
            <label>自动截图间隔（秒）</label>
            <input type="number" :value="autoSsInterval" @change="setAutoSsInterval($event)" min="10" step="5" placeholder="60" />
            <p class="hint">修改后即时生效，需先开启托盘"自动截图"</p>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import ServicesSection from './ServicesSection.vue'
import { listAvailableModels, getStoredModelPath, kindOfModelUrl, type ModelKind } from '@/services/live2d/model-discovery'
import { useDeskpetStore } from '@/stores/deskpet'

const props = defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const store = useDeskpetStore()

function get(k: string, fallback = '') { try { return localStorage.getItem(k) || fallback } catch { return fallback } }
function set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* */ } }

const wsUrl = ref(get('deskpet/ws-url', 'ws://127.0.0.1:8523/ws'))
const wsToken = ref(get('deskpet/ws-token'))
const sttUrl = ref(get('deskpet/stt-url', 'http://127.0.0.1:18530/stt'))
const autoSsInterval = ref(get('deskpet/auto-screenshot-interval', '60'))
const vadThreshold = ref(get('deskpet/vad-threshold', '0.02'))
const vadSilence = ref(get('deskpet/vad-silence', '1.5'))
const pttKey = ref('f9')
const pttMode = ref(get('deskpet/ptt-mode', 'ptt'))

const models = ref<ModelEntry[]>([])
const selectedModel = ref('')
const switching = ref(false)

/** 渲染模式由当前模型类型推导；分段开关切换时自动选中该类型第一个模型 */
const displayMode = computed<ModelKind>(() => {
  const current = selectedModel.value || store.modelUrl
  return current ? kindOfModelUrl(current) : 'live2d'
})

const filteredModels = computed(() => models.value.filter((m) => m.kind === displayMode.value))

async function setDisplayMode(kind: ModelKind) {
  if (kind === displayMode.value) return
  const first = models.value.find((m) => m.kind === kind)
  if (!first) return // 该类型下没有模型，下拉框会显示占位提示
  switching.value = true
  try {
    await store.requestModelSwitch(first.url)
  } finally {
    switching.value = false
    selectedModel.value = store.modelUrl || first.url
  }
}

async function loadModels(forceRescan = false) {
  models.value = await listAvailableModels(forceRescan)
  // 下拉框要选中真正加载中的那个模型，而不是 localStorage 里可能已失效的值
  selectedModel.value = store.modelUrl || getStoredModelPath() || models.value[0]?.url || ''
}

onMounted(() => {
  void loadModels()
  void (async () => {
    try {
      const cfg = await window.electronAPI?.getServicesConfig()
      if (cfg?.pttKey) pttKey.value = cfg.pttKey
    } catch { /* 服务配置不可用时保持默认 */ }
  })()
})
// 面板每次打开时刷新，覆盖「打开过面板之后又装了新模型」的情况
watch(() => props.open, (open) => { if (open) void loadModels() })
watch(() => store.modelUrl, (url) => { if (url) selectedModel.value = url })

async function rescan() {
  await loadModels(true)
}

function openModelsFolder() {
  void window.electronAPI?.openModelsFolder()
}

async function onModelChange(e: Event) {
  const url = (e.target as HTMLSelectElement).value
  if (!url || url === store.modelUrl) return
  switching.value = true
  try {
    await store.requestModelSwitch(url)
  } finally {
    switching.value = false
    selectedModel.value = store.modelUrl || url
  }
}

function reload() {
  window.electronAPI?.reloadWindow()
}

function setWsUrl(e: Event) { const v = (e.target as HTMLInputElement).value; wsUrl.value = v; set('deskpet/ws-url', v) }
function setWsToken(e: Event) { const v = (e.target as HTMLInputElement).value; wsToken.value = v; set('deskpet/ws-token', v) }
function setSttUrl(e: Event) { const v = (e.target as HTMLInputElement).value; sttUrl.value = v; set('deskpet/stt-url', v) }
function setAutoSsInterval(e: Event) {
  const v = (e.target as HTMLInputElement).value; autoSsInterval.value = v; set('deskpet/auto-screenshot-interval', v)
  window.electronAPI?.setAutoScreenshotInterval(parseInt(v) || 60)
}
function setVadThreshold(e: Event) {
  const v = (e.target as HTMLInputElement).value; vadThreshold.value = v; set('deskpet/vad-threshold', v)
}
function setVadSilence(e: Event) {
  const v = (e.target as HTMLInputElement).value; vadSilence.value = v; set('deskpet/vad-silence', v)
}
function setPttKey(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  pttKey.value = v
  // 热键桥读的是启动时的环境变量，改键后需要重启才生效；这里让服务管理器自动重建
  void window.electronAPI?.setServicesConfig({ pttKey: v }).then(() => window.electronAPI?.restartService('hotkey'))
}
function setPttMode(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  pttMode.value = v
  set('deskpet/ptt-mode', v)
}
</script>

<style scoped>
.settings-overlay {
  position: absolute;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: flex-end;
  background: linear-gradient(to left, rgba(9, 9, 11, 0.35), transparent 45%);
}
.settings-panel {
  width: 320px;
  height: 100%;
  background: rgba(24, 24, 27, 0.94);
  backdrop-filter: blur(20px) saturate(1.2);
  border-left: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow: -24px 0 48px -24px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
}
.settings-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 15px 18px 13px; color: #e4e4e7; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.settings-close {
  width: 26px; height: 26px; display: grid; place-items: center;
  background: none; border: none; border-radius: 8px; color: #71717a; font-size: 18px; cursor: pointer;
  transition: color 0.18s ease, background 0.18s ease;
}
.settings-close:hover { color: #e4e4e7; background: rgba(255, 255, 255, 0.08); }
.settings-close:active { transform: translateY(1px); }
.settings-body { flex: 1; overflow-y: auto; padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 22px; }
.settings-body::-webkit-scrollbar { width: 8px; }
.settings-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12); border-radius: 4px;
  border: 2px solid transparent; background-clip: padding-box;
}
.settings-body::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); background-clip: padding-box; border: 2px solid transparent; }

/* 分区依次入场，节奏感来自 60ms 阶梯 */
.section { display: flex; flex-direction: column; gap: 7px; animation: section-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }
.settings-body > :nth-child(1) { animation-delay: 0.03s; }
.settings-body > :nth-child(2) { animation-delay: 0.09s; }
.settings-body > :nth-child(3) { animation-delay: 0.15s; }
.settings-body > :nth-child(4) { animation-delay: 0.21s; }
.settings-body > :nth-child(5) { animation-delay: 0.27s; }
@keyframes section-in { from { opacity: 0; transform: translateY(10px); } }

.section-title { color: #71717a; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.2px; }
.row { display: flex; align-items: center; gap: 8px; }

/* 渲染模式分段开关 */
.seg {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.seg-btn {
  flex: 1;
  padding: 5px 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #8b8b93;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}
.seg-btn:hover { color: #d4d4d8; }
.seg-btn.on {
  background: rgba(109, 155, 209, 0.28);
  color: #e4e4e7;
}
label { color: #a1a1aa; font-size: 12px; }
input, select {
  width: 100%; padding: 8px 11px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05); color: #e4e4e7; font-size: 12.5px; outline: none;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}
input:hover, select:hover { border-color: rgba(255, 255, 255, 0.18); }
select option { background: #202024; color: #e4e4e7; }
input:focus, select:focus {
  border-color: rgba(109, 155, 209, 0.55);
  box-shadow: 0 0 0 3px rgba(109, 155, 209, 0.14);
  background: rgba(255, 255, 255, 0.07);
}
input[type="number"] { font-family: ui-monospace, Consolas, monospace; }
.btn {
  padding: 7px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.07); color: #d4d4d8; font-size: 12px; cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.1s ease;
}
.btn:hover:not(:disabled) { background: rgba(255,255,255,0.13); border-color: rgba(255,255,255,0.2); }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.45; cursor: default; }
.hint { color: #63636b; font-size: 11px; margin: 0; line-height: 1.5; }

.settings-slide-enter-active, .settings-slide-leave-active { transition: opacity 0.28s ease; }
.settings-slide-enter-from, .settings-slide-leave-to { opacity: 0; }
.settings-slide-enter-active .settings-panel, .settings-slide-leave-active .settings-panel {
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.settings-slide-enter-from .settings-panel, .settings-slide-leave-to .settings-panel { transform: translateX(48px); }
</style>

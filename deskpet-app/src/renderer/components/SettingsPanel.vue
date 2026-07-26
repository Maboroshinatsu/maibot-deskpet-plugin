<template>
  <Transition name="settings-slide">
    <div v-if="open" class="settings-overlay" @mousedown.stop>
      <div class="settings-panel">
        <div class="settings-header">
          <span>设置</span>
          <button class="settings-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="settings-body">
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
            <label>Live2D 模型</label>
            <select :value="selectedModel" @change="onModelChange($event)" :disabled="switching">
              <option v-if="models.length === 0" value="">（未找到模型）</option>
              <option v-for="m in models" :key="m.url" :value="m.url">{{ m.name }}</option>
            </select>
            <div class="row">
              <button class="btn" @click="rescan" :disabled="switching">重新扫描</button>
              <span v-if="switching" class="hint">切换中…</span>
            </div>
            <p class="hint">切换后立即生效，无需重启</p>
            <p class="hint">模型放在 public/models/，识别 *.model3.json</p>
          </div>
          <!-- 麦克风 -->
          <div class="section">
            <div class="section-title">麦克风</div>
            <label>VAD 灵敏度 (0.01~0.1，越小越灵敏)</label>
            <input type="number" :value="vadThreshold" @change="setVadThreshold($event)" min="0.005" max="0.1" step="0.005" placeholder="0.02" />
            <label>静音判定秒数</label>
            <input type="number" :value="vadSilence" @change="setVadSilence($event)" min="0.5" max="5" step="0.5" placeholder="1.5" />
            <p class="hint">修改后需重新开启麦克风生效</p>
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
import { ref, watch, onMounted } from 'vue'
import { listAvailableModels, getStoredModelPath } from '@/services/live2d/model-discovery'
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

const models = ref<ModelEntry[]>([])
const selectedModel = ref('')
const switching = ref(false)

async function loadModels(forceRescan = false) {
  models.value = await listAvailableModels(forceRescan)
  // 下拉框要选中真正加载中的那个模型，而不是 localStorage 里可能已失效的值
  selectedModel.value = store.modelUrl || getStoredModelPath() || models.value[0]?.url || ''
}

onMounted(() => { void loadModels() })
// 面板每次打开时刷新，覆盖「打开过面板之后又装了新模型」的情况
watch(() => props.open, (open) => { if (open) void loadModels() })
watch(() => store.modelUrl, (url) => { if (url) selectedModel.value = url })

async function rescan() {
  await loadModels(true)
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
</script>

<style scoped>
.settings-overlay {
  position: absolute;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: flex-end;
}
.settings-panel {
  width: 280px;
  height: 100%;
  background: rgba(18, 18, 24, 0.96);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
}
.settings-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px; color: #ddd; font-size: 15px; font-weight: 600;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.settings-close { background: none; border: none; color: #999; font-size: 20px; cursor: pointer; }
.settings-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 18px; }
.section { display: flex; flex-direction: column; gap: 6px; }
.section-title { color: #999; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.row { display: flex; align-items: center; gap: 8px; }
label { color: #bbb; font-size: 12px; }
input, select {
  width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06); color: #eee; font-size: 12px; outline: none;
}
select option { background: #1a1a20; color: #eee; }
input:focus, select:focus { border-color: rgba(120, 160, 220, 0.6); }
.btn {
  padding: 7px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.08); color: #ddd; font-size: 12px; cursor: pointer;
}
.btn:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
.btn:disabled { opacity: 0.5; cursor: default; }
.hint { color: #666; font-size: 11px; margin: 0; }

.settings-slide-enter-active, .settings-slide-leave-active { transition: all 0.25s ease; }
.settings-slide-enter-from, .settings-slide-leave-to { opacity: 0; }
.settings-slide-enter-from .settings-panel, .settings-slide-leave-to .settings-panel { transform: translateX(40px); }
.settings-slide-enter-active .settings-panel, .settings-slide-leave-active .settings-panel { transition: transform 0.25s ease; }
</style>

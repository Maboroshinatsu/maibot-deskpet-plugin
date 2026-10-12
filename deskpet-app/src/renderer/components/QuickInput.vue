<template>
  <Transition name="input-fade">
    <div v-if="visible" class="quick-input" @mousedown.stop>
      <textarea
        ref="inputRef"
        :value="modelValue"
        class="input-field"
        placeholder="输入消息与桌宠对话..."
        rows="1"
        @input="autoResize"
        @keydown.enter.prevent="emit('submit')"
        @blur="onBlur"
      />
      <button class="send-btn" @mousedown.prevent @click="emit('submit')" title="发送">
        <svg viewBox="0 0 24 24">
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  blur: []
}>()

const inputRef = ref<HTMLTextAreaElement>()

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return
    await nextTick()
    const el = inputRef.value
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
      el.focus()
    }
  },
)

watch(
  () => props.modelValue,
  async () => {
    await nextTick()
    const el = inputRef.value
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  },
)

function autoResize(event: Event) {
  const el = event.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
  emit('update:modelValue', el.value)
}

function onBlur() {
  if (!props.modelValue.trim()) {
    emit('blur')
  }
}
</script>

<style scoped>
.quick-input {
  position: absolute;
  bottom: 42px;
  width: 320px;
  max-width: calc(100vw - 24px);
  left: calc(50% - 160px + var(--stage-shift-x, 0px));
  z-index: 45;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px 9px 16px;
  border-radius: 16px;
  background: var(--dp-panel-bg);
  border: 1px solid var(--dp-border-strong);
  box-shadow: var(--dp-shadow);
  transition:
    left 0.56s var(--spring-gentle),
    border-color 0.18s ease,
    box-shadow 0.18s ease;
  -webkit-app-region: no-drag;
}

.quick-input:focus-within {
  border-color: var(--dp-accent-border);
  box-shadow:
    0 0 0 2px var(--dp-accent-soft),
    var(--dp-shadow);
}

.input-field {
  flex: 1;
  min-width: 0;
  max-height: 112px;
  padding: 4px 0;
  border: none;
  background: transparent;
  font-size: 14.5px;
  font-weight: 500;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
  color: var(--dp-text-main);
  resize: none;
  overflow-y: auto;
}

.input-field::placeholder {
  color: var(--dp-text-dim);
}

.send-btn {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  border: none;
  background: var(--dp-accent);
  color: var(--dp-accent-text, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition:
    transform 520ms var(--spring-gentle) 55ms,
    filter 180ms ease,
    opacity 180ms ease;
}

.send-btn:hover {
  filter: brightness(1.06);
}

.send-btn:active {
  transform: translateY(1px) scale(0.94);
  transition: transform 105ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}

.send-btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2.1;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.input-fade-enter-active {
  transition:
    opacity 0.2s var(--ease-out-expo),
    transform 0.24s var(--ease-out-expo);
}
.input-fade-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.input-fade-enter-from,
.input-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>

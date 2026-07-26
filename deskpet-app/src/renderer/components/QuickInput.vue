<template>
  <Transition name="input-fade">
    <div v-if="visible" class="quick-input" @mousedown.stop>
      <textarea
        ref="inputRef"
        :value="modelValue"
        class="input-field"
        placeholder="说点什么..."
        rows="1"
        @input="autoResize"
        @keydown.enter.prevent="emit('submit')"
        @blur="emit('blur')"
      />
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

watch(() => props.visible, async (visible) => {
  if (!visible) return
  await nextTick()
  const el = inputRef.value
  if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; el.focus() }
})

watch(() => props.modelValue, async () => {
  await nextTick()
  const el = inputRef.value
  if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
})

function autoResize(event: Event) {
  const el = event.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
  emit('update:modelValue', el.value)
}
</script>

<style scoped>
.quick-input {
  position: absolute;
  bottom: 15%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  max-width: 90vw;
  -webkit-app-region: no-drag;
}

.input-field {
  display: block;
  min-width: 220px;
  max-width: 100%;
  padding: 10px 16px;
  border: 1px solid rgba(24, 24, 27, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px) saturate(1.2);
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
  color: #27272a;
  resize: none;
  overflow: hidden;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.06),
    0 8px 28px -8px rgba(0, 0, 0, 0.18);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
  -webkit-app-region: no-drag;
}

.input-field:focus {
  border-color: rgba(109, 155, 209, 0.5);
  box-shadow:
    0 0 0 3px rgba(109, 155, 209, 0.16),
    0 8px 28px -8px rgba(0, 0, 0, 0.18);
}

.input-field::placeholder {
  color: #a1a1aa;
}

.input-fade-enter-active {
  transition: opacity 0.22s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.input-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.input-fade-enter-from,
.input-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px) scale(0.97);
}
</style>

<template>
  <Transition name="input-fade">
    <div v-if="visible" class="quick-input" @mousedown.stop>
      <input
        ref="inputRef"
        :value="modelValue"
        class="input-field"
        placeholder="说点什么..."
        @input="onInput"
        @keydown.enter="emit('submit')"
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

const inputRef = ref<HTMLInputElement>()

watch(() => props.visible, async (visible) => {
  if (!visible) return
  await nextTick()
  inputRef.value?.focus()
})

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<style scoped>
.quick-input {
  position: absolute;
  bottom: 15%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  min-width: 200px;
  -webkit-app-region: no-drag;
}

.input-field {
  width: 100%;
  padding: 10px 16px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  font-size: 14px;
  outline: none;
  color: #333;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  -webkit-app-region: no-drag;
}

.input-field::placeholder {
  color: #aaa;
}

.input-fade-enter-active,
.input-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.input-fade-enter-from,
.input-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}
</style>

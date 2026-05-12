<template>
  <Transition name="bubble-fade">
    <div v-if="visible" class="chat-bubble">
      <div class="bubble-content">
        <span class="bubble-text">{{ text }}</span>
        <span v-if="streaming" class="bubble-cursor">|</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  text: string
  streaming: boolean
}>()
</script>

<style scoped>
.chat-bubble {
  position: absolute;
  top: 10%;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border-radius: 16px;
  padding: 12px 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 10;
  pointer-events: none;
  -webkit-app-region: no-drag;
}

.bubble-content {
  font-size: 14px;
  line-height: 1.5;
  color: #333;
  word-break: break-word;
}

.bubble-cursor {
  animation: blink 0.8s infinite;
  color: #666;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.bubble-fade-enter-active,
.bubble-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.bubble-fade-enter-from,
.bubble-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>

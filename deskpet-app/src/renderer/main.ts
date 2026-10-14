import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useChatStore } from './stores/chat'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#app')

// 退出前主进程会阻塞关闭并请求落盘：把防抖队列里的聊天记录立即写出，
// 完成后回执，主进程才真正关窗（超时兜底见 main/index.ts）。
const chatStore = useChatStore(pinia)
window.electronAPI?.onChatHistoryFlushRequest?.(() => {
  void chatStore.flush().finally(() => {
    window.electronAPI?.notifyChatHistoryFlushed?.()
  })
})

# MaiBot Deskpet 后续开发计划

## 0. 当前状态

当前插件已经完成一轮基础交互更新：

- 桌宠窗口基础交互基本可用
- Live2D 模型可显示、拖拽、缩放、视线追踪
- 窗口位置/大小、模型缩放/偏移可持久化
- 托盘菜单可控制置顶、穿透、重置布局
- 悬停淡化、托盘图标、自定义图标已接入
- ChatBubble / QuickInput 已拆出
- 初步抽出 TransportAdapter
- 消息链路已验证到 MaiBot 插件侧
- 插件仓库已提交并推送：e1ac5ae

当前项目处于：

```text
基础桌宠可用
  ↓
需要从“单文件堆功能”转向“模块化、可扩展”
```

---

## 1. 总体开发方向

最终目标不是做一个“调用 MaiBot 的窗口”，而是做一个：

> 以 MaiBot 为大脑，以 Electron + Live2D 为身体的桌面伴侣运行时。

长期结构：

```text
MaiBot
  ├─ 人格
  ├─ 记忆
  ├─ 推理
  └─ 回复生成

Deskpet Runtime
  ├─ 窗口
  ├─ Live2D
  ├─ 表情动作
  ├─ 气泡
  ├─ TTS / 唇形
  └─ 桌面交互
```

---

## 2. 开发原则

### 2.1 不再继续扩大 DeskpetStage.vue

当前 DeskpetStage.vue 已承担过多职责：

- Pixi 初始化
- Live2D 加载
- 鼠标追踪
- 模型拖动
- 模型缩放
- hover fade
- 窗口拖动
- 输入框
- 气泡
- transport 发送
- 动画轮询

后续新功能优先放到 composable / service / store，不再直接堆进 DeskpetStage。

### 2.2 先抽逻辑，再抽 DOM

之前直接拆 Live2DCanvas.vue 时，影响了 hover fade 和 scoped CSS。因此之后应：

```text
先抽逻辑 composable
  ↓
确认行为稳定
  ↓
再抽 DOM 组件
```

暂时不要再拆 Live2D 容器。

### 2.3 桌宠身体层和 MaiBot 接入层解耦

前端不应该直接知道 input:text / ask / maim_message / OpenAI，而应该只调用：

```ts
transport.sendUserText(text)
```

所有协议差异放到 transport adapter。

---

## 3. Phase 1：基础交互收尾与结构整理

### 已完成

- 窗口拖动
- 模型拖动
- 模型缩放
- 视线追踪
- 持久化
- 托盘
- 锁定穿透
- 悬停淡化
- ChatBubble / QuickInput 拆分
- TransportAdapter 初步抽象

### 还要做

#### 1.1 拆分 store

当前 deskpet.ts 包含：

- WebSocket 连接状态
- Pixi app
- Live2D model
- 模型视图状态
- UI 状态
- 聊天气泡
- emotion
- animation

建议拆成：

```text
stores/
├── live2d.ts
│   ├── pixiApp
│   ├── live2dModel
│   ├── modelLoaded
│   ├── modelZoom
│   ├── modelOffsetX/Y
│   └── resetModelView()
│
├── chat.ts
│   ├── chatBubble
│   ├── appendChatText()
│   ├── finishChatStream()
│   └── hideChatBubble()
│
├── ui.ts
│   ├── hoverFadeEnabled
│   ├── wsConnected
│   └── UI 状态
│
└── deskpet.ts
    └── 聚合导出 / 逐步废弃
```

优先级：chat.ts → live2d.ts → ui.ts。

#### 1.2 抽 composables

优先抽：

```text
useModelDrag.ts
useModelZoom.ts
useWindowDrag.ts
useHoverFade.ts
```

##### useModelDrag.ts

负责：

- 记录 drag start
- 计算 drag offset
- clamp 模型位置
- 更新 modelOffset

输出：

```ts
onModelMouseDown
applyPendingModelDrag
```

##### useModelZoom.ts

负责：

- wheel 节流
- 根据鼠标焦点缩放
- 更新 zoom
- 更新 offset

输出：

```ts
onWheel
```

##### useWindowDrag.ts

负责：

- 导航条拖动窗口
- 调用 electronAPI.dragWindow

输出：

```ts
onNavMouseDown
```

##### useHoverFade.ts

负责：

- hover fade 开关状态
- 鼠标是否在模型区域
- 后续可做更精确 hit test

#### 1.3 确认打包图标路径

当前开发路径可用：

```ts
../renderer/icon.png
```

打包路径需要验证：

```ts
process.resourcesPath/icon.png
```

可能需要 electron-builder extraResources：

```json
"extraResources": [
  {
    "from": "src/renderer/public/icon.png",
    "to": "icon.png"
  }
]
```

### Phase 1 验收标准

- npm run build 通过
- dev 模式图标正常
- packaged 模式图标正常
- DeskpetStage 行数减少
- 现有交互无回归

---

## 4. Phase 2：Live2D 表情与动作系统

目标：让 MaiBot 回复不仅显示文字，还能驱动角色表情和动作。

当前已有：

- currentEmotion
- pendingAnimation
- state:emotion
- state:animation
- EMOTION_TO_MOTION
- playMotion()

但还不是完整系统。

### 2.1 表情系统

目标能力：

```text
emotion = happy
  ↓
设置 expression
  ↓
播放 motion
  ↓
持续一段时间
  ↓
恢复 neutral / idle
```

新增：

```text
services/live2d/expression.ts
services/live2d/motion.ts
stores/live2d.ts
```

#### expression.ts

```ts
export interface ExpressionPreset {
  emotion: string
  expression?: string
  durationMs?: number
}

export const EMOTION_TO_EXPRESSION = {
  happy: 'happy',
  sad: 'sad',
  angry: 'angry',
  surprise: 'surprise',
  thinking: 'thinking',
  shy: 'shy',
  curious: 'curious',
  neutral: 'neutral',
}
```

#### motion.ts

```ts
export interface MotionPreset {
  emotion: string
  group?: string
  index?: number
  priority?: 'idle' | 'normal' | 'force'
}

export function playEmotionMotion(model, emotion) {}
export function playNamedMotion(model, name) {}
```

### 2.2 表情状态机

新增：

```text
composables/useExpressionState.ts
```

状态：

```text
currentEmotion
lastEmotion
emotionStartedAt
emotionExpiresAt
```

逻辑：

```text
收到 happy
  ↓
设置 happy expression
  ↓
如果 duration 到期
  ↓
恢复 neutral
```

### 2.3 动作优先级

优先级：

```text
用户交互动作 > 回复动作 > idle 动作
```

初版：

```ts
enum MotionLayer {
  Interaction = 3,
  Reply = 2,
  Idle = 1,
}
```

### 2.4 协议输入

继续支持：

```json
{ "type": "state:emotion", "data": { "emotion": "happy" } }
```

```json
{ "type": "state:animation", "data": { "name": "wave", "loop": false } }
```

后续可扩展为统一事件：

```ts
interface DeskpetRuntimeEvent {
  type: 'emotion:set' | 'motion:play' | 'speech:chunk'
}
```

### Phase 2 验收标准

- 收到 state:emotion 后能切表情/动作
- 表情会自动恢复 neutral
- motion 播放不会打断视线追踪
- idle 动作不会抢回复动作
- 失败时不会崩溃，只 warning

---

## 5. Phase 3：TTS 与唇形同步

目标：让桌宠真正开口说话。

```text
MaiBot 回复文本
  ↓
TTS
  ↓
AudioContext 播放
  ↓
mouthOpen 参数驱动
  ↓
Live2D 唇形同步
```

### 3.1 TTS 方案

#### Provider A：浏览器 SpeechSynthesis

优点：

- 不需要额外依赖
- 快速验证

缺点：

- 语音质量有限

#### Provider B：Edge TTS / 外部 TTS 服务

优点：

- 语音质量好

缺点：

- 要本地服务或网络调用
- 需要队列

### 3.2 目录设计

```text
services/speech/
├── types.ts
├── speechSynthesis.ts
├── audioPlayer.ts
└── lipsync.ts
```

### 3.3 唇形同步

最小版本：

```text
播放音频时
  ↓
AnalyserNode 获取音量
  ↓
映射到 ParamMouthOpenY
```

伪代码：

```ts
const volume = getRms(audioData)
const mouthOpen = clamp(volume * 4, 0, 1)
model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', mouthOpen)
```

### 3.4 文本分段

初版按标点切：

```ts
split(/[。！？.!?]/)
```

后续再借鉴 Airi 的 chunker。

### Phase 3 验收标准

- MaiBot 回复后自动朗读
- 播放时嘴巴动
- 播放结束嘴巴闭合
- 多条回复不会重叠播放
- 可从托盘关闭 TTS

---

## 6. Phase 4：MaiBot 接入升级

目标：从当前桥接式插件逐步升级到更接近官方桌宠 / MaiBot 原生平台接入。

### 当前问题

当前插件仍是：

```python
WebSocket 收到 ask
  ↓
ctx.llm.generate()
  ↓
返回 text
```

问题：

- 不一定走完整 Maisaka
- 记忆链路不完整
- 桌宠不是正式平台
- user/session metadata 较弱

### 4.1 短期：增强当前桥接

协议增加 metadata：

```json
{
  "type": "ask",
  "data": {
    "text": "...",
    "user_id": "deskpet-user",
    "session_id": "deskpet",
    "platform": "deskpet"
  }
}
```

插件侧保留这些字段，为后续迁移做准备。

### 4.2 中期：兼容 maim_message

参考 MaiM-desktop-pet 的消息结构：

```text
MessageBase
UserInfo
GroupInfo
FormatInfo
Seg
```

前端新增：

```text
transport/maim.ts
```

目标：

```text
DeskpetTransport
  ├── chimera.ts
  └── maim.ts
```

UI 不变，只替换 adapter。

### 4.3 长期：MaiBot 原生 platform

理想结构：

```text
deskpet platform
  ↓
MaiMessage
  ↓
Maisaka
  ↓
A-Memorix
  ↓
Replyer
  ↓
Deskpet response
```

需要研究：

- MaiBot QQ 适配器消息入口
- Discord/其他平台适配方式
- 是否允许插件注册 platform
- 是否需要轻改 MaiBot 本体

### Phase 4 验收标准

短期：

- 当前 ask 保留 metadata
- 前端 transport 不变

中期：

- 可选 maim adapter
- 与官方桌宠项目协议对齐

长期：

- 桌宠和 QQ 共享 MaiBot 人格/记忆/推理

---

## 7. Phase 5：配置与产品化

目标：从开发 demo 变成用户可配置的桌宠插件。

### 5.1 设置入口

初期从托盘菜单进入：

```text
设置
  ├─ 模型路径
  ├─ TTS 开关
  ├─ 悬停淡化
  ├─ 置顶
  ├─ 锁定穿透
  ├─ 重置布局
```

### 5.2 配置文件

当前：

```text
Renderer localStorage
主进程 userData/window-state.json
插件 config.toml
```

后续可统一为：

```text
deskpet-state.json
window-state.json
transport-config.json
```

### 5.3 打包发布

需要确认：

- Windows 打包
- icon 路径
- Cubism runtime 是否随包
- models 是否随包
- Electron 安装体积

### Phase 5 验收标准

- 新用户 clone 后按 README 能跑
- 不需要手动复制隐藏文件
- 图标正常
- 托盘正常
- 模型正常加载

---

## 8. 推荐下一步执行顺序

### Step 1：不要继续拆 Live2D DOM

先保持当前稳定版本。

### Step 2：抽逻辑 composable

优先：

```text
useWindowDrag.ts
useModelDrag.ts
useModelZoom.ts
```

收益：

- 不改变视觉结构
- 不碰 Pixi 容器
- 不影响 hover fade
- 让 DeskpetStage 继续变瘦
- 为后续 Live2D 表情系统腾空间

### Step 3：做表情/动作系统

从：

```text
services/live2d/expression.ts
services/live2d/motion.ts
```

开始。

### Step 4：再考虑 TTS

等 motion/expression 稳定后，再做 speech/lipsync。

---

## 9. 风险点

### 9.1 继续拆 Live2D DOM 容易破坏 hover / CSS

解决：

- 暂时不拆
- 先抽逻辑

### 9.2 MaiBot 接入路线不确定

解决：

- transport adapter 保持抽象
- 不把协议写死进 UI

### 9.3 TTS 会引入异步队列复杂度

解决：

- 先单条播放
- 再做队列
- 最后做优先级

### 9.4 Live2D 模型差异大

解决：

- 允许 per-model 配置
- scale/offset 持久化
- motion/expression 映射可配置

---

## 10. 简短路线图

```text
当前
  ↓
桌宠基础交互稳定 ✅
  ↓
拆 UI 组件 ✅
  ↓
抽交互 composables
  ↓
Live2D 表情/动作系统
  ↓
TTS + 唇形同步
  ↓
transport 接 maim_message
  ↓
MaiBot 原生 platform / 共享记忆
```

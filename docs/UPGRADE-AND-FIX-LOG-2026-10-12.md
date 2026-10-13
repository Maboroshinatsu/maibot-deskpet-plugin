# MaiBot 桌宠插件升级与修复全量记录（2026-10-11 ～ 2026-10-12）

本文档完整记录自 **2026-10-11 接手 Codex 工作区收尾** 至 **2026-10-12 傍晚** 的所有架构升级、核心机制设计、问题修复、性能调优与交互界面重塑，供后续开发、调试与跨项目（如 Uta）复用参考。

---

## 一、阶段时间线总览（从最开始定位至今）

| 阶段 | 时间区间（UTC+8） | 核心主题 | 关键产出 |
| :--- | :--- | :--- | :--- |
| **阶段 1** | 10-11 14:17 ～ 15:24 | Codex 现场收尾、剥离提交与窗口拖拽限位修复 | 提交 `3b7ab77`、`801b5ac`（v0.6.3）、`c94790f`（任务栏限位与高 DPI 拖拽防膨胀） |
| **阶段 2** | 10-11 15:24 ～ 19:32 | Live2D 控件自动识别、水印剥离、滑块暴露与 PTT 本地化 | 启发式识别作者水印/多部件控件、原生 Electron `globalShortcut` 替代 Python PTT 桥 |
| **阶段 3** | 10-11 19:36 ～ 22:32 | 伴随浮窗重构、状态预设体系与模型级持久化 | 零遮挡伴随舞台横移、模型目录 `deskpet-presets.json` 随模型持久化、渐变过渡 |
| **阶段 4** | 10-12 08:04 ～ 11:30 | IPC 克隆修复、穿透锁静默、多步分镜预设与「常驻 vs 反应」双模机制 | 解决 `ERROR: AN OBJECT COULD NOT BE CLONED`、实现 `mode: 'persistent' \| 'reaction'` 与多步 `steps` 序列 |
| **阶段 5** | 10-12 11:35 ～ 14:58 | Biophilic（自然有机）UI 重塑、预设工坊、快捷圆点与物理弹簧动效 | 燕麦白昼 / 森林暗夜双主题 + 自定义取色、预设工坊折叠分类、四角圆角同步、悬停导航条 |
| **阶段 6** | 10-12 15:04 ～ 17:10 | 视线精准跟随、全栈性能调优、TTS 口型同步修复、Codex 遗留清单落地與待机灵动偏移恢复 | 矩阵逆变换精准目光跟随、零冗余重绘、PCM 块级 RMS 口型同步、待机视线漫游合成 |
| **阶段 7** | 10-12 17:22 ～ 18:20 | 情绪分组随机变体抽取、行级抽屉手风琴与全局去模糊 | 情绪分组与防连重随机抽取、左侧小箭头展开变体抽屉、全面移除 `backdrop-filter` 与非整数 `transform` 发虚 |

---

## 二、核心机制详解（重点备忘）

### 1. 状态预设体系：常驻状态 vs 短暂反应 vs 情绪分组随机变体

相关文件：
- 前端状态模型与匹配：[emotion-adapter.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/services/live2d/emotion-adapter.ts)
- 前端表情/预设状态机：[useExpressionState.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/composables/useExpressionState.ts)
- 后端协议解析与 Action/Tool 调用：[plugin.py](file:///d:/Frankenstein/maibot-deskpet-plugin/plugin.py)

#### （1）预设的数据结构（`ModelStatePreset`）
每个预设支持以下核心字段：
- `name`：预设唯一名称（如 `"开心·欢呼"`、`"害羞·脸红偷瞄"`）。
- `group`：所属情绪分组（如 `"开心"`、`"害羞"`、`"生气"`、`"难过"`、`"惊讶"`、`"窘迫"`、`"状态"`、`"待机"`）。未显式填写时由 `resolvePresetGroup()` 根据预设名（如 `分组·变体` 前缀或关键词）自动归类。
- `emotion`：关联的基础情绪标识（如 `happy`、`shy`、`angry`）。
- `mode`：执行模式：
  - `'reaction'`（**播完恢复 / 短暂反应**）：播放完预设分镜或持续时长（默认约 `4200ms`）后，**自动平滑过渡回当前钉住的「常驻基底预设」（`pinnedPresetName`）**。适合各种情绪反应（开心、害羞、委屈、尴尬等）。
  - `'persistent'`（**持续保持 / 常驻状态**）：触发后**永久保持该状态**，并自动更新 `pinnedPresetName`，成为后续所有 `reaction` 预设演完后回归的新基底。适合换装、抱猫、常驻待机姿态。
- `steps`：多步分镜数组（`ModelStateStep[]`），每步可独立配置：
  - `controls`：部件开关表（`Record<string, boolean>`）
  - `sliders`：连续参数滑块表（`Record<string, number>`，如脸红、黑脸、视线偏移、歪头角度）
  - `motion`：绑定的动作组与索引（`{ group, index }`）
  - `durationMs`：该步持续毫秒数（多步按序衔接，单步平滑插值过渡 `260ms`）

#### （2）后端如何调用前端预设，以及如何决定「保持」还是「回到常驻」？
1. **前端上报（`sys:controls`）**：
   每当模型加载完成或用户在「预设工坊」新建/编辑/删除预设时，前端通过 WebSocket 发送 `sys:controls`，将完整 `presets` 列表（包含 `name`、`group`、`emotion`、`mode`、`steps` 等）同步给 MaiBot 后端插件。
2. **后端暴露给 LLM**：
   后端 [plugin.py](file:///d:/Frankenstein/maibot-deskpet-plugin/plugin.py) 中的 `_format_presets_summary()` 将预设按 `group` 聚合，生成可读摘要注入到 `ControlDeskpetModelAction` 与 `ControlDeskpetTool` 的 Prompt 描述中（例如：`【开心】可传 group="开心" 随机抽取，或指定：开心·欢呼、开心·歪头笑`）。
3. **后端下发指令（`model:control`）**：
   - 当 LLM 传入分组名（如 `preset="开心"` 或 `emotion="happy"`）时，后端 `_match_model_preset()` 识别到该分组下有多个变体，调用 `_choose_random_group_preset()` **在组内随机抽取一个变体（自动避开上一次刚用过的变体，防止连续重复）**。
   - 后端向前端发送 `model:control` 消息（携带匹配到的具体 `preset` 名称及参数）。
4. **前端执行与自动恢复**：
   - 前端 [useExpressionState.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/composables/useExpressionState.ts) 中的 `applyStatePreset(preset)` 接管执行：
   - 若该预设 `mode === 'persistent'`（或后端显式指定 `hold: true`），则将其设为新的 `pinnedPresetName` 并一直保持；
   - 若该预设 `mode === 'reaction'`，则按序播放 `steps` 分镜，计时结束后调用 `restoreDefaultAppearance()`，**自动平滑插值回到 `pinnedPresetName`（若未钉选常驻预设，则回到默认基底外观）**。
   - **编辑保护**：当用户在设置面板「预设工坊」展开编辑某个预设时，前端会暂停自动回退计时器，避免用户正在调参时模型突然跳回默认状态。

#### （3）预设跟随模型目录持久化
- 主进程 [src/main/index.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/main/index.ts) 提供 `deskpet:read-model-presets` 与 `deskpet:write-model-presets` IPC 通道。
- 每个模型的自定义预设直接保存在该模型目录同级的 `deskpet-presets.json` 中（且通过 `JSON.parse(JSON.stringify(...))` 剥离 Vue `Proxy`，避免 Electron IPC 克隆报错），模型迁移或打包时预设直接随模型文件夹走。

---

### 2. 视线跟随与灵动待机合成机制

相关文件：
- [loader.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/services/live2d/loader.ts)
- [DeskpetStage.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/DeskpetStage.vue)
- [useExpressionState.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/composables/useExpressionState.ts)

1. **为什么之前鼠标移到模型胸口/脸上时模型却没有正对屏幕？**
   - `pixi-live2d-display` 自带的 `model.focus(x, y)` 内部使用 `toGlobal` 坐标直接归一化，没有逆变换模型缩放与局部锚点，且内置阻尼在帧间被覆盖。
   - **修复方案**：在 [loader.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/services/live2d/loader.ts) 实现 `focusLive2DModel()`，用 `model.toLocal()` 将屏幕光标转换到模型内部局部坐标系，并以**头部/视线中心**（高度约 `0.24 * refH` 处）作为原点归一化到 `[-1, 1]`，直接设置 `focusController.targetX / targetY`。
2. **为什么修完精准跟随之后，默认待机显得僵硬？如何兼顾？**
   - 早期为了防止内置 Idle 动作覆盖鼠标视线，在 `beforeModelUpdate` 里用静态值覆盖了头/眼/身体参数，导致内置 Idle 动作的呼吸摇摆与微表情丢失。
   - **修复方案（叠加态待机漫游）**：
     - 保留模型原生 Idle 动作的物理呼吸与身体摆动，当滑块处于默认零位时不覆盖 `ParamAngleX/Y/Z`、`ParamBodyAngleX`。
     - 在 [loader.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/services/live2d/loader.ts) 中引入**双频非谐波正弦漫游偏移（Idle Gaze Drift）**：
       - 当光标进入桌宠窗口（或距离模型较近）时，漫游权重平滑衰减到 `0`，模型精准注视光标；
       - 当光标离开桌宠窗口静置时，漫游权重平滑升至 `1`，在柔和跟随远处光标的基准上叠加自然的眼神游离与微转头，既有陪伴感又不死板。
     - 当预设分镜显式控制眼球/头部滑块（如「尴尬·左顾右盼」）时，`focusSuppressed` 自动置为 `true`，暂停鼠标视线接管，让分镜眼神完整演出。

---

### 3. TTS 语音口型同步（LipSync）修复

相关文件：
- [plugin.py](file:///d:/Frankenstein/maibot-deskpet-plugin/plugin.py)
- [useLipSync.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/composables/useLipSync.ts)
- [loader.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/services/live2d/loader.ts)

1. **问题根因**：
   - 后端流式 TTS 发送的 `voice:stream:chunk` 是裸 PCM16 字节流，而前端早期尝试用 `AudioContext.decodeAudioData`（仅支持完整 WAV/MP3 文件头）解码，导致静默失败回退到假正弦波张嘴；
   - 此外 `useLipSync.ts` 在 `coreModel.update()` 之前写参数，被 motion 更新覆盖。
2. **修复方案**：
   - **后端实时包络**：[plugin.py](file:///d:/Frankenstein/maibot-deskpet-plugin/plugin.py) 在发送每个 PCM 分块时，直接用 `memoryview(...).cast("h")` 计算该块 RMS 音量包络并归一化为 `mouth: 0.0 ~ 1.0` 随 `voice:stream:chunk` 下发。
   - **前端精准对齐播放时钟**：[useLipSync.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/composables/useLipSync.ts) 按音频块在 `AudioContext` 中的真实排期时间窗（`startAt ~ endAt`）建立时间轴队列，并在 `AnalyserNode` 可用时结合实时频域能量驱动。
   - **渲染管线挂载**：通过 [loader.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/services/live2d/loader.ts) 的 `setModelLipSync()` 挂入 `beforeModelUpdate` 钩子，确保口型开合度在 Motion 之后、Physics 之前写入 `ParamMouthOpenY`。

---

### 4. 窗口拖拽、穿透与多模型水印/控件适配

1. **高 DPI 下拖拽导航条窗口越拖越大 & 任务栏遮挡（已提交 `c94790f`）**：
   - [src/main/index.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/main/index.ts)：拖拽开始时锁定整数 `width/height`，移动过程中使用 `setBounds({ x, y, width, height })` 替代 `setPosition`（规避 Windows 非 100% 缩放下的 DPI 尺寸膨胀 Bug），并基于 `screen.getDisplayMatching(bounds).workArea` 限制底部导航条不低于工作区底边（不被任务栏遮挡）。
2. **锁定鼠标穿透（Click-Through）静默模式**：
   - 开启穿透锁定时，[DeskpetStage.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/DeskpetStage.vue) 自动隐藏四周内阴影提示框、底部拖拽条与侧边按钮栏，仅保留桌面托盘恢复入口，彻底消除无法点击却仍弹出悬停框的干扰。
3. **作者水印自动剥离与部件中文化**：
   - [emotion-adapter.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/services/live2d/emotion-adapter.ts)：自动识别 `watermark`、`水印`、`logo`、`credit`、`sign` 等参数（含 `RetrynowMiku` 的 `Param44 / Part22` 水印图层），在模型加载时自动将其透明度/开关闭合，并从用户可见控件列表中隐藏。
   - 内置常见 Live2D 部件与面部捕捉滑块的中英映射字典（发型、服饰、配饰、手臂动作、脸红、黑脸、泪水、星星眼、歪头、视线等）。

---

### 5. 全栈性能审查与优化项

1. **WebGL 渲染与主线程减负（[DeskpetStage.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/DeskpetStage.vue)）**：
   - `startAnimationPoll` 中增加脏检查：仅当鼠标坐标、舞台偏移或模型变换矩阵实际发生改变时才调用 `focusLive2DModel`；未说话且嘴巴已闭合归零时跳过每帧 `setModelLipSync` 调用。
   - 窗口被最小化或完全不可见时暂停不必要的高频计算。
2. **全局光标轮询按需休眠（[src/main/index.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/main/index.ts)）**：
   - 主进程 30fps 的 `screen.getCursorScreenPoint()` 仅在窗口可见且未最小化时发送，且当光标坐标未变化时跳过 IPC 广播，大幅降低静置时的 Electron IPC 唤醒开销。
3. **PTT 热键本地化**：
   - 默认使用 Electron 原生 `globalShortcut` 处理本地热键，无需额外拉起 Python `hotkey-bridge` 子进程。

---

### 6. 伴随式 UI 设计与「彻底消除文字模糊」规范

相关文件：
- [SettingsPanel.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/SettingsPanel.vue)
- [QuickInput.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/QuickInput.vue)
- [ChatBubble.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/ChatBubble.vue)
- [DeskpetStage.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/DeskpetStage.vue)

1. **零遮挡伴随布局**：
   - 面板打开时，根据桌宠在屏幕左/右半区自动决定面板弹出方向（`pop-left` / `pop-right`），同时角色层 `.stage-actor-layer` 向反方向平滑横移 `±108px`，保证调参和换装时完全不挡模型。
2. **自然有机双主题与自定义取色**：
   - 支持日间（温暖燕麦底色 + 鼠尾草绿强调色）与夜间（深林暗夜底色）切换，支持自定义主题色取色器（自动通过 HSL 衍生柔和底色、边框色与文字对比色）。
   - 面板左上角快捷圆点支持在「打开设置」中切换功能：主题调色盘 / 快捷切换模型抽屉 / 快捷切换 Live2D 与静态立绘。
3. **情绪分组胶囊与行级变体抽屉**：
   - 预设列表保持双列紧凑小胶囊排布：
     - **点击胶囊主体**：直接切换到该分组的默认（第一个）预设；
     - **点击分组名称前方的箭头按钮（`.capsule-expand-btn`）**：箭头旋转 `90deg`，在当前行下方通过 `grid-template-rows: 0fr <-> 1fr` 平滑展开组内全部变体，并支持「随机抽取」「+ 变体」与「收起」。
   - 滚动容器 `.bio-scroll` 设置 `scrollbar-gutter: stable`，展开列表出现纵向滚动条时绝不挤压胶囊宽度。
4. **Electron 透明窗口防模糊铁律（已全量落地）**：
   - **禁用 `backdrop-filter: blur(...)`**：在透明 Electron + WebGL 画布上方使用 `backdrop-filter` 会引发 Chromium 背景合成模糊，导致面板边缘与文字发虚；现已全部替换为高不透明度实色面板变量 `var(--dp-panel-bg)`。
   - **禁止在文字容器上保留 `transform: scale(...)` 或非整数 `translateX(-50%)`**：
     - 所有抽屉动画统一采用纯 `grid-template-rows: 0fr <-> 1fr` + `opacity` 过渡；
     - 居中悬浮框（如双击唤起的 [QuickInput.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/QuickInput.vue)）采用偶数宽度 + `left: calc(50% - 160px + var(--stage-shift-x, 0px))` 整数像素对齐，确保 ClearType 亚像素抗锯齿始终生效。

### 7. 轻量化分发与双模语音识别（云端 STT 直连 + 本地 INT8 按需下载）

相关文件：
- [electron-builder.yml](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/electron-builder.yml)
- [src/main/index.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/main/index.ts)
- [src/main/services.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/main/services.ts)
- [ServicesSection.vue](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/renderer/components/ServicesSection.vue)
- [stt-bridge.py](file:///d:/Frankenstein/maibot-deskpet-plugin/stt-bridge.py)

1. **安装包瘦身 ~900MB**：
   - 从 [electron-builder.yml](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/electron-builder.yml) 的 `extraResources` 中移除原本随包捆绑的 `894.2 MB` FP32 `sensevoice/model.onnx`。
2. **云端 STT 主进程直连（0 内存占用、无需启动 Python 桥）**：
   - 在「后台服务 -> 语音识别（STT）配置」中支持一键切换：
     - **硅基流动 SenseVoiceSmall（`siliconflow`）**：免费调用，走 `/v1/audio/transcriptions`；
     - **阿里云百炼 Qwen-Audio-ASR（`dashscope`）**：若留空 Key 自动复用云 TTS 已配置的百炼 Key；
     - **Groq Whisper-Large-v3-Turbo（`groq`）**；
     - **自定义 OpenAI 兼容 ASR（`openai`）**。
   - API Key 通过 Electron `safeStorage` 加密落盘（`sttApiKeyEncrypted`），转写结果自动剥离 SenseVoice `<|...|>` 情感/语种标签。
3. **本地离线 STT 按需下载 INT8 量化模型（~226MB）**：
   - 当用户选择本地离线 STT 模式时，[stt-bridge.py](file:///d:/Frankenstein/maibot-deskpet-plugin/stt-bridge.py) 优先加载 `model.int8.onnx`（体积缩减 75%，解码更快、内存减半），若用户目录 `%APPDATA%\maibot-deskpet\sensevoice` 尚未缓存，则在首次语音识别时自动从国内镜像（`hf-mirror.com`）按需下载并输出实时百分比日志，后续客户端升级无需重复下载。

### 8. v1.0.1 强化通信安全、修复百炼语音合成与系统稳定性（2026-10-13）

相关文件：
- [plugin.py](file:///d:/Frankenstein/maibot-deskpet-plugin/plugin.py)
- [cloud-tts-bridge.py](file:///d:/Frankenstein/maibot-deskpet-plugin/cloud-tts-bridge.py)
- [deskpet-app/src/main/index.ts](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/src/main/index.ts)
- [.github/workflows/release.yml](file:///d:/Frankenstein/maibot-deskpet-plugin/.github/workflows/release.yml)

1. **🛡️ 通信安全加固（Origin 来源白名单校验）**：
   - 增加 `_is_trusted_origin()` 校验，默认仅信任桌面客户端、本地回环或设置了安全 Token 的合法连接，自动拦截来自外部网页未授权的跨域 WebSocket 嗅探与连接。
   - 插件在卸载停用时增加 2 秒有界超时保护，超时强制断开客户端，防止网关任务阻塞导致整个插件卸载卡死。

2. **🔊 阿里云百炼 / CosyVoice TTS 音频解析与下载修复**：
   - 修复 DashScope 同步非流式接口返回 JSON 响应（含 `output.audio.url`）时，原程序未能正确下载音频而是误将 JSON 当作音频数据的 Bug。现在会自动提取链接并完成音频流下载，并能在接口返回错误码时提供清晰的错误提示。

3. **⚡ 云端语音识别（STT）防卡死保护**：
   - 为阿里云百炼与 OpenAI 兼容云端 STT 的主进程网络请求统一挂载 30 秒超时（`AbortSignal.timeout(30_000)`）。彻底解决因网络断连或云端 API 无响应时，录音状态机一直卡在“正在转写”而无法发起下一次录音的问题。

4. **📁 模型路径容错与动作预设安全落盘**：
   - 导入名称包含 `#`（原本会被浏览器内核当成 URL 锚点截断）或 `%`（原本会导致 URI 解码错误）的模型文件夹时，现已完成路径分段编码，确保能正常被桌宠加载渲染。
   - 自定义动作预设在模型安装目录不可写（如权限受限或便携目录只读）时，自动降级安全保存至应用的用户数据目录（`userData`），彻底杜绝用户配置静默丢失。

5. **⚙️ 插件配置即时热生效**：
   - 在 MaiBot 插件管理中开启/禁用桌宠插件、修改端口或更新安全 Token 时，插件会自动平滑重启并应用新配置，无需重启整个 MaiBot 主程序。

---

## 三、自动化测试验证状态

1. **Python 插件单测与语音管线测试**：
   - [tests/test_plugin_lifecycle.py](file:///d:/Frankenstein/maibot-deskpet-plugin/tests/test_plugin_lifecycle.py) 与 [tests/test_cloud_tts_bridge.py](file:///d:/Frankenstein/maibot-deskpet-plugin/tests/test_cloud_tts_bridge.py)：**22 / 22 全部通过**（涵盖 Origin 信任域校验、有界停机收敛、多步分镜解析、情绪分组抽取、百炼音频下载等）。
2. **Node 端无麦克风全量回归测试**：
   - [deskpet-app/tests/](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/tests)：**84 / 84 全部通过**（涵盖 `services.test.cjs`、`ptt.test.cjs`、`voice-input.test.cjs`、`imageset.test.cjs` 等）。
3. **主进程服务与看门狗自检**：
   - [deskpet-app/watchdog_selftest.py](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/watchdog_selftest.py) 14 项自检通过；[deskpet-app/tests/runtime-services.cjs](file:///d:/Frankenstein/maibot-deskpet-plugin/deskpet-app/tests/runtime-services.cjs) 7 项集成测试通过。
4. **双端类型检查**：
   - `npm run typecheck`（包含主进程 node 与渲染层 web）0 报错通过。

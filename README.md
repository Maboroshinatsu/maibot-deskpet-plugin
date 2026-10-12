# MaiBot Deskpet — 桌面宠物 Live2D 插件

基于 Electron + Vue 3 + PixiJS + Live2D Cubism 4 的 MaiBot 桌面宠物插件，为 MaiBot 提供高表现力、低资源占用的桌面伴随角色。支持 **Live2D 模型部件与去水印零配置解析**、**多步分镜「预设工坊」**、**情绪分组随机变体抽取**、**常驻基底 / 短暂反应双模状态机**、**精准目光跟随与灵动待机漫游**、**云端直连 / 本地 INT8 按需语音识别（STT）**、**多平台与第三方兼容语音合成（TTS）** 以及 **实时块级 RMS 唇形同步**。

---

## 快速开始（轻量安装版，推荐）

1. 从 [Releases](https://github.com/Maboroshinatsu/maibot-deskpet-plugin/releases) 下载 `MaiBot-Deskpet-Setup-x.x.x.exe` 并安装（安装包已剥离臃肿离线权重，体积仅 **~85 MB**，内置默认 Live2D 模型与静态立绘示例包）。
2. 将本仓库放入 MaiBot 的 `plugins/` 目录（Python 依赖由 `_manifest.json` 声明，随 MaiBot 自动安装），并按 [完整安装与配置 (docs/SETUP.md)](docs/SETUP.md) 完成配置。
3. 启动 MaiBot，双击桌面「MaiBot 桌宠」：
   - **语音识别（STT）**：可在设置面板「打开设置 → 后台服务」中一键开启 **云端 · 硅基流动 SenseVoice（免费推荐，0 内存占用、无需启动本地桥）**，或切换为 **本地 · SenseVoice INT8（226MB 按需自动安装）**。
   - **语音合成（TTS）**：支持按需切换 **硅基流动 CosyVoice2 / IndexTTS**、**阿里云百炼 CosyVoice**、**小米 MiMo**、**Fish Audio**、**GSV2P**、**自定义第三方兼容（`/v1/audio/speech`）** 或 **本地 GPT-SoVITS 整合包**。
   - **全局 PTT 热键**：由客户端通过 Windows 原生 `user32.dll!GetAsyncKeyState` 非阻塞接管，无需 Python 环境、绝不吞键。

> **安全机制说明**：MaiBot 上报的本机 Python 解释器路径仅作为待审核候选展示在「后台服务 → Python 解释器环境（高级）」中，必须经过本机原生系统确认框批准后才会用于启动本地桥进程；断线或刷新后自动撤销授权。

---

## 核心特性

### 1. 自然有机伴随界面（Biophilic Companion UI）
- **零遮挡伴随舞台**：展开设置面板或聊天抽屉时，自动根据桌宠所处屏幕左/右半区决定弹出方向，同时角色层向反方向平滑横移避让，调参换装全程不挡模型。
- **琥珀暖棕默认主题与日/夜双模式**：
  - 内置温暖日间模式与深邃纯净夜间模式（HSL 低饱和同色相微调，彻底杜绝暗色混色发脏）。
  - 支持预设色板与自由取色器，根据主题色相对亮度自动计算胶囊前景对比色。
- **左上角可配置快捷圆点（Quick Orb）**：可在设置中将其绑定为「快捷切换模型抽屉」「快捷切换 Live2D / 静态立绘」「自定义主题取色器」或「切换日/夜模式」。
- **像素级清晰文字渲染**：全面移除透明窗口下会导致 ClearType 亚像素抗锯齿失效的 `backdrop-filter: blur` 与文字层 `scale` 合成，所有抽屉采用纯 `grid-template-rows: 0fr <-> 1fr` 物理曲线展开。
- **锁定穿透静默模式（`Ctrl+Alt+L`）**：开启鼠标穿透锁定时，自动收起浮窗并完全隐藏悬停内阴影边框、底部导航条与侧边按钮栏，仅保留系统托盘恢复入口。

---

### 2. 预设工坊：多步分镜、常驻/反应双模与情绪分组随机变体
- **零配置自动解析与去水印**：
  - 自动扫描模型目录下的 `.model3.json`、`.exp3.json`、`.cdi3.json`、`.vtube.json`。
  - 自动识别并剥离常见模型作者水印图层/参数（含顶点偏移型与透明度型水印），将有效部件归类为可视化开关胶囊。
- **多步关键帧分镜（Keyframe Steps）**：
  - 每个预设可包含 1～N 个连续分镜步骤，每步可独立设置 **过渡时长**、**保持时长**、**部件开关组合** 以及 **12 项 VTB 面捕姿态滑条**（头部偏航/俯仰/侧倾、身体旋转、双眼开合、笑眼、眼球水平/垂直视线、眉毛高低、嘴巴开合与微笑弧度）。
  - 支持配置如「尴尬：先左顾右盼 → 再垂眸移开视线」的连续神态演出。
- **常驻基底 vs 短暂反应双模协同**：
  - **持续保持（`hold` / 常驻状态）**：触发后长期保持，并自动钉为当前的「常驻基底预设」（如日常待机、换装、抱猫姿态）。
  - **播完恢复（`revert` / 短暂反应）**：按序演完分镜与保持时间后，**自动通过平滑插值回归到当前钉选的常驻基底预设**；当用户在「预设工坊」展开编辑某个预设时，自动暂停回退计时，防止调参中途跳回。
  - **循环播放（`loop`）**：在多个关键帧步之间往复循环演出。
- **情绪分组与防连重随机变体**：
  - 预设列表采用双列紧凑胶囊排布：**点击胶囊主体**直接切换至该分组的默认（首个）预设；**点击分组名左侧小箭头**平滑展开行级变体抽屉（支持「随机抽取」「+ 变体」与「收起」）。
  - 当 MaiBot 后端按情绪分组（如 `开心`、`害羞`、`生气`、`难过`、`惊讶`、`窘迫`）调用桌宠时，自动在组内多个预设变体间**随机抽取（自动避开上一次刚用过的变体，防止连续重复）**，大幅丰富角色反应多样性。
- **预设随模型文件夹持久化（`deskpet-presets.json`）**：
  - 所有自定义预设与分组直接保存在当前模型目录下的 `deskpet-presets.json`，迁移、备份或分享模型文件夹时预设自动随行。

---

### 3. 精准目光跟随与灵动待机漫游
- **局部头部锚点逆变换目光跟随**：使用 `model.toLocal()` 将全局屏幕光标逆变换至模型内部坐标系，以角色头部/双眼高度为原点归一化，彻底解决传统全局坐标映射导致的「看胸口不看屏幕」问题。
- **双频非谐波待机视线漫游（Idle Gaze Drift）**：
  - 当光标进入窗口或靠近角色时，漫游权重平滑归零，角色精准注视光标；
  - 当光标离开窗口静置时，在柔和跟随远端光标的基础上叠加双频非谐波正弦视线漫游与原生 Idle 呼吸摆动，兼顾精准交互与待机灵动感。
- **分镜视线自动让位**：当预设分镜显式控制了眼球或头部滑块时，自动暂挂鼠标视线追踪，保证分镜眼神完整演出。

---

### 4. 按模式收敛的语音管线（云端直连 + 本地按需 + 块级唇形同步）
- **后台服务面板按模式动态显隐**：
  - 切换语音识别（STT）或语音合成（TTS）模式时，自动隐藏并停止与当前所选模式无关的后台桥进程，界面清爽不冗余。
- **双模语音识别（STT）**：
  - **云端 STT 直连（默认推荐）**：支持 **硅基流动 `FunAudioLLM/SenseVoiceSmall`（免费）**、**阿里云百炼 `qwen-audio-asr`**、**Groq `whisper-large-v3-turbo`** 及 **自定义 OpenAI 兼容端点（`/v1/audio/transcriptions`）**，由 Electron 主进程直接请求，0 本地内存占用，自动清洗 `<|...|>` 标签。
  - **本地离线 SenseVoice INT8（226MB 按需安装）**：优先加载体积缩减 75% 的 `model.int8.onnx`；若本地未缓存，首次识别时自动从国内镜像（`hf-mirror.com`）下载至 `%APPDATA%/maibot-deskpet/sensevoice` 并实时输出百分比进度，升级桌宠永不重下。
- **多平台与第三方兼容语音合成（TTS）**：
  - 支持 **硅基流动 CosyVoice2 / IndexTTS**、**阿里云百炼 CosyVoice**、**小米 MiMo TTS**、**Fish Audio**、**GSV2P（在线 GPT-SoVITS）**、**自定义第三方兼容（`/v1/audio/speech`）** 以及 **本地 GPT-SoVITS 整合包**。
  - 所有云端 API Key 均经由 Electron `safeStorage` 加密存储于本机。
- **流式 PCM 块级 RMS 唇形同步**：
  - 后端在发送每个流式 PCM16 音频分块时实时计算 RMS 能量包络，前端按 `AudioContext` 真实播放时间窗对齐并挂载至 Live2D `beforeModelUpdate` 管线，说话结束立即闭合归零。

---

## 文档导航

| 文档 | 说明 |
| :--- | :--- |
| [完整安装与配置 (docs/SETUP.md)](docs/SETUP.md) | MaiBot 配置、插件安装、Python 解释器审批、语音服务配置与排错指南 |
| [升级与修复全量记录 (docs/UPGRADE-AND-FIX-LOG-2026-10-12.md)](docs/UPGRADE-AND-FIX-LOG-2026-10-12.md) | 状态预设机制、多步分镜、情绪分组随机抽取、视线合成、口型同步与防模糊规范详解 |
| [静态立绘模式 (docs/IMAGE-SET.md)](docs/IMAGE-SET.md) | 使用 PNG/SVG 差分图片包作为桌宠角色的配置指南 |
| [Live2D 模型适配规范 (docs/MODEL-ADAPTER-SPEC.md)](docs/MODEL-ADAPTER-SPEC.md) | 自定义 `deskpet-adapter.json` 高级适配规范说明 |

---

## 项目结构

```text
maibot-deskpet-plugin/
├── README.md
├── _manifest.json                # MaiBot 插件清单（版本与 Python 依赖声明）
├── config.toml                   # 插件运行时配置
├── plugin.py                     # MaiBot 插件主入口（MessageGateway + 预设分组随机抽取 + 流式口型包络）
├── gpt-sovits-bridge.py          # 本地 GPT-SoVITS TTS 桥 (端口 9881)
├── cloud-tts-bridge.py           # 多平台与 OpenAI 兼容云端 TTS 桥 (端口 9882)
├── stt-bridge.py                 # 本地 SenseVoice INT8 按需下载 STT 桥 (端口 18530)
├── watchdog.py                   # 桥进程父进程存活看门狗
├── tests/                        # Python 插件生命周期与情绪分组单元测试
├── docs/                         # 安装配置、架构记录与模型适配文档
└── deskpet-app/                  # Electron + Vue 3 桌面端应用
    ├── electron-builder.yml      # Windows NSIS 轻量化安装包配置（npm run dist）
    ├── tests/                    # Node/前端无麦克风全量回归测试套件
    └── src/
        ├── main/                 # Electron 主进程（窗口/DPI 限位、云端 STT 直连、服务管理、Win32 热键）
        ├── preload/              # 安全上下文桥接（contextBridge IPC）
        └── renderer/             # Vue 3 + Pinia + PixiJS 渲染进程
            ├── components/       # 舞台、伴随设置面板（含预设工坊与服务面板）、双击输入框、气泡组件
            ├── composables/      # 表情/预设状态机、音频时间轴口型同步、语音输入与 WebSocket
            ├── services/         # Live2D 加载/逆变换视线/待机漫游、情绪适配与宿主协议
            └── stores/           # Pinia 状态仓库（模型预设分组、主题外观、连接状态）
```

---

## 开发与测试

```powershell
# 进入桌面端目录
cd deskpet-app

# 1. 运行 TypeScript 全量类型检查（Node + Vue）
npm run typecheck

# 2. 运行无麦克风全量回归测试（宿主协议 + 模型生命周期 + 运行时信任策略 + 静态立绘）
npm run test:no-mic

# 3. 运行 Python 插件生命周期与情绪分组单元测试
python -m unittest discover -s ../tests -p "test_*.py"

# 4. 构建生产包并生成 Windows NSIS 安装程序
npm run dist
```

---

## 致谢

- **[MaiBot](https://github.com/MaiM-with-u/MaiBot)** — 插件运行的宿主平台
- **[Airi](https://github.com/moeru-ai/airi)** — PixiJS Live2D 渲染方案参考
- **[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)** — 本地语音合成引擎
- **[Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx)** — SenseVoice 语音识别运行时

## 许可

[GPL-3.0](LICENSE) — 本项目遵循与 MaiBot 相同的 GPL-3.0 许可证。

# MaiBot Deskpet — 桌面宠物 Live2D 插件

基于 Electron + Vue3 + PixiJS + Live2D Cubism 4 的 MaiBot 桌面宠物插件，为 MaiBot 提供可交互的 Live2D 角色桌面伴侣。支持 GPT-SoVITS 语音合成、SenseVoice 语音识别、实时唇形同步与桌面截图识图。

## 快速开始（安装版，推荐）

1. 从 [Releases](https://github.com/Maboroshinatsu/maibot-deskpet-plugin/releases) 下载 `MaiBot-Deskpet-Setup-x.x.x.exe` 并安装——内置全部 Live2D 模型和 SenseVoice 语音识别模型
2. 把本仓库放进 MaiBot 的 `plugins/` 目录（语音桥的 Python 依赖由 manifest 声明，随插件装进 MaiBot 的 Python 环境），并完成下方「安装与运行 → 第零步」的 MaiBot 配置
3. 启动 MaiBot，双击桌面「MaiBot 桌宠」——STT/TTS 桥随桌宠自动启动，直接复用 MaiBot 的 Python 环境，**不需要单独安装 Python**；状态灯和日志在设置面板 ⚙ →「后台服务」

语音合成需要额外安装 GPT-SoVITS 整合包（可选），跑源码 / 二次开发请看下方「安装与运行」的完整流程。

## 功能一览

### 桌面交互
- **Live2D 角色**：透明窗口，始终置顶，视线追踪（全局鼠标跟随）
- **静态立绘模式**：无 Live2D 模型也可用，PNG/SVG 情绪换图 + VN 风小跳。见 [docs/IMAGE-SET.md](docs/IMAGE-SET.md)
- **模型操控**：滚轮缩放（鼠标焦点）、拖拽平移、窗口拖动
- **手动切表情**：右键点击桌宠循环切换情绪
- **布局持久化**：缩放/偏移/窗口位置自动保存与恢复
- **悬停淡化**：鼠标悬停时模型半透明

### 对话
- **双向对话**：经 MaiBot MessageGateway 接入完整推理管线
- **聊天气泡**：漫画风格浮动气泡 + 聊天记录抽屉面板
- **表情系统**：MaiBot 可通过 Tool 控制角色表情与动作动画
- **表情包**：MaiBot 从表情库选取匹配表情包发到桌宠

### 语音
- **GPT-SoVITS TTS**：角色专属声线，HTTP 桥接（端口 9881）
- **云 TTS**：接入小米 MiMo / 阿里云 CosyVoice / GSV2P，免本地部署，填 API Key 即用（端口 9882）
- **SenseVoice STT**：离线语音识别，支持中英日韩，HTTP 桥接（端口 18530）
- **VAD 语音检测**：自动检测说话/静音，无需手动操作麦克风
- **PTT 全局热键**：按住说话 / 开关切换，键位可配
- **实时唇形同步**：多正弦波叠加算法（参考 NachoBot）
- **音频顺序播放**：多条回复排队播放，不互相打断

### 截图识图
- **手动截图**：托盘「截图识图」，桌面截屏发送给 MaiBot 视觉模型分析
- **自动截图**：定时截屏（间隔可配），MaiBot 主动根据屏幕内容搭话

### 设置与服务管理
- **后台服务管理**：STT/TTS 桥、GPT-SoVITS、PTT 热键随桌宠自动启动，面板内状态灯、启停/重启、实时日志；可选「终端窗口」模式；退出自动清理子进程
- **模型热切换**：设置面板选中即换，无需重启
- **托盘菜单**：显示/隐藏、置顶、锁定穿透、悬停淡化、截图、重置布局
- **快捷键**：Ctrl+Alt+H 显示隐藏、Ctrl+Alt+F 悬停淡化、Ctrl+Alt+L 锁定穿透、Ctrl+R/F5 重载、Ctrl+Shift+I 开发者工具

## 模型资源

项目默认使用 Live2D 官方免费示例模型 **Hiyori (日和)**。模型来源：

- [Live2D 官方示例](https://www.live2d.com/zh-CHS/learn/sample/)
- [imuncle/live2d](https://github.com/imuncle/live2d/tree/master)
- [summerscar/live2dDemo](https://github.com/summerscar/live2dDemo)

把模型文件夹（或 `deskpet-images.json` 立绘包）放进 `deskpet-app/src/renderer/public/models/`，设置面板「显示」区选择即可，切换立即生效。首次加载的默认模型由 `src/renderer/services/model-config.ts` 的 `MODEL_PATH` 决定，面板选过之后优先记住你的选择。

## 文档

| 文档 | 内容 |
|------|------|
| [完整安装与配置](docs/SETUP.md) | MaiBot 配置、插件安装、依赖、AI 模型、启动、排错、跨设备连接、配置项 |
| [静态立绘模式](docs/IMAGE-SET.md) | 不用 Live2D，用图片当角色（清单格式、自定义情绪、特效） |
| [Live2D 模型适配规范](docs/MODEL-ADAPTER-SPEC.md) | 让 AI 为你的模型生成适配文件（deskpet-adapter.json） |

## 项目结构

```
maibot-deskpet-plugin/
├── README.md
├── _manifest.json                # 插件清单（含依赖声明）
├── config.toml                   # 运行时配置
├── plugin.py                     # 插件入口（MaiBot MessageGateway）
├── start.bat                     # 一键启动（源码/开发方式）
├── gpt-sovits-bridge.py          # GPT-SoVITS TTS 桥 (端口 9881)
├── stt-bridge.py                 # SenseVoice STT 桥 (端口 18530)
├── hotkey-bridge.py              # PTT 全局热键桥（pynput）
├── docs/
│   ├── SETUP.md                  # 完整安装与配置
│   ├── IMAGE-SET.md              # 静态立绘模式
│   ├── MODEL-ADAPTER-SPEC.md     # Live2D 模型适配规范（给 AI 看的）
│   └── deskpet-adapter.schema.json
└── deskpet-app/                  # Electron 前端
    ├── electron-builder.yml      # 安装包打包配置（npm run dist）
    └── src/
        ├── main/                 # 主进程（index.ts + services.ts 服务管理器）
        ├── preload/              # 预加载脚本
        └── renderer/             # Vue3 渲染进程
```

## 兼容性

- 基于 MaiBot **dev 分支**（1.0.0pre）开发
- **仅兼容 MaiBot 1.0.0 及以上版本**
- **当前仅在 Windows 上测试通过**，macOS / Linux 理论兼容但未经测试
- 支持本地使用和局域网/VPN 跨设备远程连接

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 34 + electron-vite |
| 前端 | Vue 3.5 + Pinia + TypeScript |
| 2D 渲染 | PixiJS 6 + pixi-live2d-display (Cubism 4) |
| 后端通信 | WebSocket (websockets Python) |
| AI 接入 | MaiBot MessageGateway 插件协议 |
| TTS | GPT-SoVITS (HTTP API v2, 角色声线克隆) |
| STT | SenseVoice (sherpa-onnx, 本地离线) |

## 致谢

- **[MaiBot](https://github.com/MaiM-with-u/MaiBot)** — 插件运行的宿主平台
- **[Airi](https://github.com/moeru-ai/airi)** — PixiJS Live2D 渲染方案的重要参考
- **[NachoBot](https://github.com/RachelForster/Shinsekai)** — GPT-SoVITS 集成方案与音频处理管线参考
- **[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)** — 语音合成引擎
- **[Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx)** — SenseVoice 语音识别运行时
- **[NapCat](https://github.com/NapNeko/NapCatQQ)** — 图片消息格式参考

## 更新日志

### v0.6.0 — 开箱即用：复用 MaiBot Python 环境（当前）

- [x] 静态立绘模式：不用 Live2D，图片当角色（清单格式、自定义情绪、交叉淡入、VN 风小跳、说话差分、待机随机）
- [x] PTT 全局热键（pynput 桥，按住说话 / 开关切换）
- [x] 桥脚本复用 MaiBot 的 Python（manifest 声明依赖，MaiBot 自动安装）
- [x] TTS 角色声线可视化配置（参考音频 + 文本，不再改脚本）
- [x] 模型自定义情绪上报（sys:emotions），AI 工具可用自定义键
- [x] 文档拆分：README 瘦身 + docs/ 专题页

### v0.5.0 — 产品化：安装版 + 后台服务管理

- [x] Windows NSIS 独立安装包（内置全部模型与 SenseVoice）
- [x] 后台服务管理：桥进程随桌宠自启、状态灯/日志/可选终端窗口、退出自动清理
- [x] Live2D 模型适配规范 v1（docs/MODEL-ADAPTER-SPEC.md）
- [x] 全量代码审查修复 30 项
- [x] UI 打磨：设置/聊天/输入框统一设计语言

### v0.3.0 — AI 感官 + 设置面板

- [x] GPT-SoVITS TTS、SenseVoice STT、VAD、截图识图、表情系统、唇形同步、音频队列、表情包

### v0.2.0 — TTS + 表情系统

- [x] Piper TTS（后替换为 GPT-SoVITS）、唇形同步、表情状态机

### v0.1.0 — 初始版本

- [x] Live2D 透明窗口渲染、MaiBot MessageGateway 双向管线、滚轮缩放/拖拽/视线追踪、表情/动作 Tool

## 许可

[GPL-3.0](LICENSE)

本项目作为 MaiBot 的插件，遵循与 MaiBot 相同的 GPL-3.0 许可证。

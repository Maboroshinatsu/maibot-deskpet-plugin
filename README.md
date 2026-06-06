# MaiBot Deskpet — 桌面宠物 Live2D 插件

基于 Electron + Vue3 + PixiJS + Live2D Cubism 4 的 MaiBot 桌面宠物插件，为 MaiBot 提供可交互的 Live2D 角色桌面伴侣。支持 GPT-SoVITS 语音合成、SenseVoice 语音识别、实时唇形同步与桌面截图识图。

## 致谢

本项目受到以下开源项目的启发和帮助：

- **[MaiBot](https://github.com/MaiM-with-u/MaiBot)** — 插件运行的宿主平台，提供消息管线和 AI 推理能力
- **[Airi](https://github.com/moeru-ai/airi)** — PixiJS Live2D 渲染方案的重要参考
- **[NachoBot](https://github.com/RachelForster/Shinsekai)** — GPT-SoVITS 集成方案与音频处理管线参考
- **[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)** — 语音合成引擎
- **[Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx)** — SenseVoice 语音识别运行时
- **[NapCat](https://github.com/NapNeko/NapCatQQ)** — 图片消息格式参考

## 模型资源

项目默认使用 Live2D 官方免费示例模型 **Hiyori (日和)**。你也可以从以下渠道获取更多模型：

- [Live2D 官方示例](https://www.live2d.com/zh-CHS/learn/sample/)
- [imuncle/live2d](https://github.com/imuncle/live2d/tree/master)
- [summerscar/live2dDemo](https://github.com/summerscar/live2dDemo)

将模型文件夹放入 `deskpet-app/src/renderer/public/models/`，在设置面板中修改模型路径。

### 自定义模型适配

每个 Live2D 模型可以在 `.model3.json` 同目录放置 `deskpet-adapter.json`，用于声明桌宠情绪到模型动作/表情/参数，以及语义动作到模型动作的映射。

示例：

```json
{
  "version": 1,
  "modelId": "your-model",
  "emotions": {
    "happy": {
      "expression": "smile",
      "motion": { "group": "Tap", "index": 0 }
    },
    "sad": {
      "expression": "sad"
    },
    "neutral": {
      "expression": "default"
    }
  },
  "animations": {
    "wave": {
      "motion": { "group": "Tap", "index": 1 }
    },
    "sleep": {
      "motion": { "group": "FlickDown", "index": 0 }
    }
  }
}
```

支持的情绪：`happy`、`sad`、`angry`、`surprise`、`thinking`、`shy`、`curious`、`neutral`、`idle`。

支持的语义动作：`wave`、`jump`、`spin`、`sit`、`sleep`、`wake`、`dance`、`cheer`。当前 `animations` 只支持 `motion`，不支持 `expression` / `parameters`；`expression` / `parameters` 仅用于情绪。

如果模型配置了 `expression`，建议同时配置 `neutral` 的默认表情，方便非中性表情结束后恢复。

没有 `deskpet-adapter.json` 的模型仍可正常加载，只是不会响应情绪动作/表情。

## 项目结构

```
maibot-deskpet-plugin/
├── README.md
├── _manifest.json                # 插件清单
├── config.toml                   # 运行时配置
├── plugin.py                     # 插件入口（MaiBot MessageGateway）
├── start.bat                     # 一键启动桌宠 + AI 桥
├── gpt-sovits-bridge.py          # GPT-SoVITS TTS 桥 (端口 9881)
├── stt-bridge.py                 # SenseVoice STT 桥 (端口 18530)
└── deskpet-app/                  # Electron 前端
    ├── package.json
    ├── electron.vite.config.js
    └── src/
        ├── main/                 # Electron 主进程
        │   └── index.ts
        ├── preload/              # 预加载脚本
        │   └── index.ts
        └── renderer/             # Vue3 渲染进程
            ├── components/       # DeskpetStage, ChatBubble, QuickInput, SettingsPanel
            ├── composables/      # useWebSocket, useVad, useVoiceInput, useLipSync 等
            ├── services/         # Live2D 加载、Transport、TTS
            ├── stores/           # Pinia 状态管理
            └── public/           # Live2D Cubism 运行时 + 模型文件 + 图标
```

## 兼容性

- 基于 MaiBot **dev 分支**（1.0.0pre）开发
- **仅兼容 MaiBot 1.0.0 及以上版本**
- **当前仅在 Windows 上测试通过**，macOS / Linux 理论兼容但未经测试
- 支持本地使用和局域网/VPN 跨设备远程连接

## 功能

### 桌面交互
- **Live2D 角色**：透明窗口，始终置顶，视线追踪（全局鼠标跟随）
- **模型操控**：滚轮缩放（鼠标焦点）、拖拽平移、窗口拖动（底部导航条）
- **布局持久化**：模型缩放/偏移、窗口位置/大小自动保存与恢复
- **悬停淡化**：鼠标悬停时模型半透明，查看遮挡区域
- **自定义图标**：托盘与任务栏图标使用 `public/icon.png`

### 对话
- **双向对话**：通过 MaiBot MessageGateway 接入完整推理管线（Planner → Replyer → 回复）
- **聊天气泡**：漫画风格浮动气泡（左上角，5 秒自动消失） + 聊天记录面板
- **消息流**：用户/AI 双色气泡，流式文字实时更新，自动滚屏
- **表情系统**：MaiBot 可通过 Tool 控制角色表情与动作动画
- **表情包**：MaiBot 可从表情库选取匹配表情包发送到桌宠显示

### 语音
- **GPT-SoVITS TTS**：角色专属声线，自然语气，HTTP 桥接（端口 9881）
- **SenseVoice STT**：离线语音识别，支持中英日韩，HTTP 桥接（端口 18530）
- **VAD 语音检测**：自动检测说话/静音，无需手动操作麦克风
- **实时唇形同步**：多正弦波叠加算法（参考 NachoBot）
- **音频顺序播放**：多条回复排队播放，不互相打断

### 截图识图
- **手动截图**：托盘「截图识图」，桌面截屏发送给 MaiBot 视觉模型分析
- **自动截图**：定时截屏（间隔可配），MaiBot 主动根据屏幕内容搭话
- **NapCat 兼容**：图片以 base64 + hash 格式通过管道，与 QQ 图片处理同路径

### 设置
- **设置面板**：右侧滑入面板，连接地址/模型路径/VAD 参数/截图间隔/自动截图间隔
- **托盘菜单**：显示/隐藏、置顶、锁定穿透、悬停淡化、截图、自动截图、重置布局
- **快捷键**：Ctrl+Alt+H 显示隐藏、Ctrl+Alt+F 悬停淡化、Ctrl+Alt+L 锁定穿透

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

## 安装与运行

### 第零步：MaiBot 配置（必要）

在安装插件前，需要先编辑 MaiBot 的 `config/bot_config.toml`，让 MaiBot 认识桌宠平台和用户。

**1. 注册桌宠平台**

在 `[bot]` 节的 `platforms` 数组中添加 `"deskpet:deskpet-user"`：

```toml
[bot]
platforms = ["deskpet:deskpet-user"]
```

如果已经有其他平台（如 QQ），用逗号分隔：

```toml
[bot]
platforms = ["qq:123456789", "deskpet:deskpet-user"]
```

**2. 为桌宠配置专属 Prompt（必读）**

在 `[[chat.chat_prompts]]` 中新增一条，让 AI 知道桌宠场景下该怎样说话，以及桌宠用户对应哪个 QQ 用户。替换 `qq:12345678` 和昵称为你自己的：

```toml
[[chat.chat_prompts]]
platform = "deskpet"
item_id = "deskpet-user"
rule_type = "private"
prompt = "你是 Live2D 桌面宠物，正在和用户一对一私聊。回复简短自然，像朋友聊天。桌宠用户和 qq:12345678 (昵称:千石可乐) 是同一个人，共享记忆和对话上下文。可以使用 set_deskpet_emotion 和 trigger_deskpet_animation 工具。"
```

如果不需关联 QQ，去掉身份映射那句即可。

### 第一步：安装插件到 MaiBot

打开 MaiBot 目录，找到 `plugins` 文件夹，把本仓库整个放进去：

```text
你的MaiBot目录/
└── plugins/
    └── maibot-deskpet-plugin/    ← 整个仓库放这里
        ├── _manifest.json
        ├── plugin.py
        ├── config.toml
        ├── start.bat
        ├── gpt-sovits-bridge.py
        ├── stt-bridge.py
        └── deskpet-app/          ← 前端代码
```

### 第二步：安装前端依赖

打开命令行（在桌宠目录里右键 → "在终端中打开"，或 `cd` 进去）：

```bash
cd 你的MaiBot目录/plugins/maibot-deskpet-plugin/deskpet-app
npm install
```

> 如果 `npm install` 卡住不动，先设置国内镜像再重试：
> ```bash
> npm config set registry https://registry.npmmirror.com
> npm install
> ```

安装成功后，`deskpet-app` 下会多出一个 `node_modules` 文件夹。

### 第三步：安装 Python 依赖

桌宠需要用 Python 跑 STT 和 TTS 桥，先装依赖包：

> 如果还没有装 Python，先去 [python.org](https://www.python.org/downloads/) 下载安装（勾选"Add Python to PATH"）

```bash
pip install aiohttp websockets edge-tts sherpa-onnx numpy
```

验证安装成功：

```bash
python -c "import aiohttp; import sherpa_onnx; print('OK')"
```

看到 `OK` 就说明装好了。

### 第四步（可选）：安装 AI 模型

> 没有模型也能用桌宠聊天，只是没有语音功能。不需要语音功能可以跳到第五步。

---

**A. SenseVoice 语音识别模型**（约 900MB，离线识别用）

> ⚠️ 如果使用 PowerShell，请用下方「PowerShell」版命令。CMD / Git Bash 用户用「CMD」版。

**CMD 版：**

```bash
mkdir deskpet-app\sensevoice 2>nul
curl -L -o deskpet-app\sensevoice\model.onnx "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.onnx"
curl -L -o deskpet-app\sensevoice\tokens.txt "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt"
```

**PowerShell 版：**

```powershell
New-Item -ItemType Directory -Force -Path deskpet-app\sensevoice
curl.exe -L -o deskpet-app\sensevoice\model.onnx "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.onnx"
curl.exe -L -o deskpet-app\sensevoice\tokens.txt "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt"
```

> PowerShell 的 `curl` 实际上是 `Invoke-WebRequest` 的别名，不支持 `-L` 参数。请使用 `curl.exe`（Windows 自带）。

> 这两个文件正确路径：
> ```text
> deskpet-app/sensevoice/model.onnx      ← 约 900MB
> deskpet-app/sensevoice/tokens.txt      ← 约 300KB
> ```

---

**B. GPT-SoVITS 语音合成**（需要 NVIDIA 显卡，CPU 也可但较慢）

1. 下载 [GPT-SoVITS 整合包](https://github.com/RVC-Boss/GPT-SoVITS)，解压到任意位置
2. 下载角色模型（权重文件 `.ckpt` + `.pth` + 参考音频 `.wav`）
3. 打开 `gpt-sovits-bridge.py`，修改这三行：

```python
REF_AUDIO_PATH = r"你的参考音频路径.wav"
PROMPT_TEXT = "参考音频里说的文本内容"
```

4. 打开 `start.bat`，找到 `GSV_DIR` 这一行，改成你的整合包路径：

```bat
set "GSV_DIR=D:\你的GPT-SoVITS目录"
```

### 第五步：启动

**双击 `start.bat`**，会弹出 4 个命令行窗口：

| 窗口标题 | 作用 | 必须？ |
|---------|------|--------|
| STT Bridge | 语音识别 | 可选 |
| GPT-SoVITS API | 语音合成 | 可选 |
| TTS Bridge | 文字→语音 | 可选 |
| Deskpet | 桌宠前端 | ✅ 必须 |

然后**手动启动 MaiBot**。

> 如果 GPT-SoVITS 没配，TTS 窗口会提示"TTS 未启动"，不影响聊天。

### 第六步：测试是否正常

1. 确认桌宠窗口显示角色模型
2. 双击模型弹出输入框，发一条消息
3. 如果 MaiBot 回复了文字，说明**插件通信正常**
4. 如果有 GPT-SoVITS，回复后应有语音朗读
5. 点右下角 🎤 按钮测试语音输入

### 常见问题

| 问题 | 解决 |
|------|------|
| `npm install` 失败 | 设置国内镜像或挂代理 |
| `python` 命令找不到 | 重新安装 Python，勾选"Add to PATH" |
| `curl` 无法下载模型 | 用浏览器打开链接手动下载，放到对应目录 |
| 桌宠窗口黑屏 | 检查 `deskpet-app/src/renderer/public/` 里的 Live2D 模型文件 |
| 桌宠没连上 MaiBot | 确认 MaiBot 启动且有加载插件，检查 `config.toml` 端口 |
| TTS 没声音 | `gpt-sovits-bridge.py` 的 `REF_AUDIO_PATH` 是否正确 |
| STT 不识别 | `sensevoice/` 目录下两个文件是否齐全 |

## 跨设备连接（局域网 / VPN）

### 服务器端（运行 MaiBot 的机器）

编辑 `config.toml`：

```toml
[ws_server]
host = "0.0.0.0"
port = 8523
auth_token = "你的密码"
```

开放防火墙端口 8523。

### 客户端（运行桌宠的机器）

启动桌宠，打开设置面板（⚙ 按钮），填入服务器 IP 地址：

- **WS 地址**：`ws://服务器IP:8523/ws`
- **WS Token**：如果服务器端设置了
- **STT 地址**：`http://服务器IP:18530/stt`

修改后刷新页面。

### 安全注意事项

- **CORS 配置**：STT 桥（端口 18530）和 TTS 桥（端口 9881）默认允许所有来源的跨域请求（`Access-Control-Allow-Origin: *`），这是为了方便本地开发。如果对外暴露这些端口，请通过反向代理（如 nginx）添加访问控制。
- **鉴权令牌**：`config.toml` 中的 `auth_token` 默认为空。在局域网或公网使用时务必设置强密码，并在客户端设置面板中填写对应的 WS Token。
- **绑定地址**：默认绑定 `127.0.0.1`（仅本机）。如需跨设备使用，将 `host` 改为 `0.0.0.0`，但务必同时设置 `auth_token`。
- **STT 地址可配**：客户端可自定义 STT 地址，指向任意服务器。仅在信任的网络环境中使用此功能。

## 配置

编辑 `config.toml`：

```toml
[plugin]
enabled = true
config_version = "1.0.0"

[ws_server]
host = "127.0.0.1"       # 本机；跨设备改为 "0.0.0.0"
port = 8523
auth_token = ""           # 跨设备时建议设置密码

[chat]
stream_buffer_size = 50
```

前端设置（快捷键 ⚙）：

| 配置项 | 存储位置 | 默认值 |
|--------|---------|--------|
| WS 地址 | localStorage `deskpet/ws-url` | `ws://127.0.0.1:8523/ws` |
| WS Token | localStorage `deskpet/ws-token` | 空 |
| STT 地址 | localStorage `deskpet/stt-url` | `http://127.0.0.1:18530/stt` |
| VAD 灵敏度 | localStorage `deskpet/vad-threshold` | `0.02` |
| 静音判定秒数 | localStorage `deskpet/vad-silence` | `1.5` |
| 自动截图间隔 | localStorage `deskpet/auto-screenshot-interval` | `60` |

## 启发的方向与未来计划

### 借鉴 Shinsekai / NachoBot

本项目在 TTS 集成、音频处理管线、GPT-SoVITS 适配器模式方面受到以下项目的启发：

- **NachoBot**：TTS 适配器中继网关模式、情感分类器、音频后处理
- **Shinsekai**：TTSAdapter 抽象 + 工厂模式、角色卡片系统、DAG 工作流管道

### v0.4 — 感官增强

- [ ] 麦克风全局快捷键（按住说话，需解决原生键盘钩子兼容性）
- [ ] 多角色声线切换（设置面板可选 GPT-SoVITS 预设）
- [ ] 情绪驱动声线切换（根据文本情绪选不同参考音频）
- [ ] 浏览器内置 TTS 回退

### v0.5 — 产品化

- [ ] 设置面板完善（更多配置项、一键恢复默认）
- [ ] 窗口尺寸自动适配模型
- [ ] 打包为独立安装包（Windows NSIS / macOS DMG）
- [ ] 静态立绘模式（无需 Live2D 模型，PNG + 情绪标签切换）

## 更新日志

### v0.3.0 — AI 感官 + 设置面板

- [x] GPT-SoVITS TTS 集成（HTTP 桥，角色声线，语音参数可调）
- [x] SenseVoice STT 离线语音识别（sherpa-onnx，多语种）
- [x] VAD 语音活动检测（自动检测说话/静音，灵敏度可配）
- [x] 桌面截图识图（手动/自动，NapCat 兼容图片管道）
- [x] 设置面板（连接/显示/VAD/截图配置，右侧滑入）
- [x] 聊天气泡改版（漫画气泡 + 消息流面板 + 按钮栏纵向排列）
- [x] NachoBot 多正弦波唇形同步算法
- [x] 音频顺序播放队列
- [x] 表情包支持（从 MaiBot 表情库选取）
- [x] TTS 后端抽象（可插拔接口）
- [x] 一键启动脚本 start.bat
- [x] 跨设备远程连接支持（WS / STT 地址可配）
- [x] 自动截图定时器 + 间隔可配

### v0.2.0 — TTS + 表情系统

- [x] Piper 本地 TTS 语音合成（已替换为 GPT-SoVITS）
- [x] 唇形同步
- [x] 表情状态机（自动恢复 neutral）
- [x] 动作优先级系统（Idle / Reply / Interaction 三层）
- [x] 空闲动画调度器
- [x] Store 拆分 + Composable 重构
- [x] Transport Adapter 抽象

### v0.1.0 — 初始版本

- [x] Live2D 角色透明窗口渲染
- [x] MaiBot MessageGateway 双向消息管线
- [x] 滚轮缩放、拖拽平移、视线追踪、窗口拖动
- [x] 表情/动作 Tool 组件

## 许可

[GPL-3.0](LICENSE)

本项目作为 MaiBot 的插件，遵循与 MaiBot 相同的 GPL-3.0 许可证。

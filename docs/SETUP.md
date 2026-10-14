# MaiBot Deskpet — 完整安装与配置

> 本文档是**完整教程**。快速上手请看根目录 [README](../README.md) 的「快速开始」。

## 目录
- [第零步：MaiBot 配置（通常无需手动改）](#第零步maibot-配置通常无需手动改)
- [第一步：安装插件到 MaiBot](#第一步安装插件到-maibot)
- [第二步：安装前端依赖（仅源码方式）](#第二步安装前端依赖仅源码方式)
- [第三步：Python 依赖（通常无需手动操作）](#第三步python-依赖通常无需手动操作)
- [第四步（可选）：安装 AI 模型](#第四步可选安装-ai-模型)
- [第五步：启动](#第五步启动)
- [第六步：测试是否正常](#第六步测试是否正常)
- [常见问题](#常见问题)
- [跨设备连接（局域网 / VPN）](#跨设备连接局域网--vpn)
- [配置项一览](#配置项一览)

---

## 第零步：MaiBot 配置（通常无需手动改）

**不需要在 `config/bot_config.toml` 里注册桌宠平台。**

新版 MaiBot 已废弃 `[bot] platforms` 的用法（账号与身份改由各适配器自行上报），WebUI 中也没有对应设置项。桌宠的平台身份（`deskpet` / `deskpet-user`）由本插件通过 MessageGateway 自动上报——装上插件、桌宠连上即可收发消息，无需任何额外配置。

**（可选）让麦麦在桌宠场景下换个说话风格**

默认情况下桌宠私聊会走 MaiBot 的通用私聊提示词。若想让它在桌宠场景下更简短自然，可在 **MaiBot WebUI 的聊天提示词设置**里为 `deskpet` 平台的私聊新增一条；也可以直接编辑 `config/bot_config.toml`（该段路径随 MaiBot 版本变化，常见为 `[[chat.chat_prompts]]` 或 `[[chat.reply_style.chat_prompts]]`）：

```toml
[[chat.reply_style.chat_prompts]]
platform = "deskpet"
item_id = "deskpet-user"
rule_type = "private"
prompt = "你是 Live2D 桌面宠物，正在和用户一对一私聊。回复简短自然，像朋友聊天。可以使用 set_deskpet_emotion 和 trigger_deskpet_animation 工具。"
```

如果希望桌宠与某个 QQ 账号共享记忆和对话上下文，在提示词里补一句身份映射即可（例如「桌宠用户和 qq:12345678（昵称:xxx）是同一个人」）。

---

## 第一步：安装插件到 MaiBot

打开 MaiBot 目录，找到 `plugins` 文件夹，把本仓库整个放进去：

```text
你的MaiBot目录/
└── plugins/
    └── maibot-deskpet-plugin/    ← 整个仓库放这里
        ├── _manifest.json
        ├── plugin.py
        ├── cloud-tts-bridge.py
        ├── gpt-sovits-bridge.py
        ├── stt-bridge.py
        ├── hotkey-bridge.py
        └── deskpet-app/          ← 前端代码
```

> **用安装版 exe 时**：MaiBot 插件目录只需要 `plugin.py` 和 `_manifest.json` 两个文件即可（运行时配置文件 `config.toml` 会在 MaiBot 首次加载插件时根据 `DeskpetPluginConfig` 配置模板自动生成）——前端和桥脚本都打进安装包了，不需要整仓库。

---

## 第二步：安装前端依赖（仅源码方式）

> 用安装版 exe 的话跳过这一步——前端已经打进安装包里了。

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

---

## 第三步：Python 依赖（安装版用户无需配置）

> **💡 如果你使用的是安装版（exe）或免安装便携版（zip）：**  
> 桌宠日常文本聊天、云端语音识别（STT）和云端语音合成（TTS）**均完全不需要配置 Python**，开箱即用，可直接跳到第五步！

**仅当你需要运行本地脚本桥（如本地 GPT-SoVITS 语音桥）时才需关注：**

1. **环境确认**：桌宠连上 MaiBot 后，会自动识别 MaiBot 的 Python 环境。为保障安全，桌宠会弹出系统提示框请你确认，点击“确认”即可自动复用 MaiBot 的 Python，免去手动查找和配置路径的繁琐操作。
2. **所需依赖**：如果你的 MaiBot 缺少运行桥接所需的 Python 依赖，MaiBot 插件管理器通常会自动拉取安装；若需手动安装，在 MaiBot 所在的 Python 环境运行以下命令即可：

可用 **MaiBot 的 Python 环境** 运行桥，通常不需要另装一套 Python。所需依赖已在 `_manifest.json` 里声明：

```text
websockets / aiohttp / sherpa-onnx / numpy / pynput
```

MaiBot 安装插件时会自动安装这些依赖。如果你的 MaiBot 版本不做依赖安装，或安装失败，用 **MaiBot 的 Python** 手动装一次即可：

```bash
# MaiBot 一键包：用 MaiBot 目录下的 Python（如 runtime\python.exe 或 .venv\Scripts\python.exe）
python -m pip install aiohttp websockets sherpa-onnx numpy pynput
```

验证（用同一个 Python 跑）：

```bash
python -c "import aiohttp; import sherpa_onnx; print('OK')"
```

---

## 第四步（可选）：安装 AI 模型

> 没有模型也能用桌宠聊天，只是没有语音功能。不需要语音功能可以跳到第五步。

**A. SenseVoice 语音识别模型**（约 900MB，离线识别用）

> 安装版 exe 已内置该模型（在 `resources\bridges\sensevoice\`），跳过 A 节即可。以下仅源码方式需要。

> ⚠️ 如果使用 PowerShell，请用下方「PowerShell」版命令。CMD / Git Bash 用户用「CMD」版。

**CMD 版：**

```bash
mkdir deskpet-app\sensevoice 2>nul
curl -L -o deskpet-app\sensevoice\model.onnx "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.onnx"
curl -L -o deskpet-app\sensevoice\tokens.txt "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt"
```

**PowerShell 版：**

```powershell
New-Item -ItemType Directory -Force deskpet-app\sensevoice | Out-Null
Invoke-WebRequest -Uri "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.onnx" -OutFile deskpet-app\sensevoice\model.onnx
Invoke-WebRequest -Uri "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt" -OutFile deskpet-app\sensevoice\tokens.txt
```

> 也支持中英日韩等多语种。

**B. GPT-SoVITS 语音合成**（需要 NVIDIA 显卡，CPU 也可但较慢）

1. 下载 [GPT-SoVITS 整合包](https://github.com/RVC-Boss/GPT-SoVITS)，解压到任意位置
2. 下载角色模型（权重文件 `.ckpt` + `.pth` + 参考音频 `.wav`）
3. 在桌宠 **设置面板 → 后台服务 → 服务路径配置** 中填写「GPT-SoVITS 整合包目录」（常见路径会自动探测，探测到就不用填）
4. 配置参考音频（角色声线 `.wav`）和它对应的文本（设置面板 → 服务路径配置）

**C. 云 TTS（可选，免本地部署）**

不想跑本地 GPT-SoVITS？桌宠内置云 TTS 桥，支持三个线上后端，填 API Key 即用：

| 后端 | 特点 | 凭证获取 |
|------|------|---------|
| 小米 MiMo | OpenAI 兼容，支持风格标签（开心/方言/唱歌） | [mimo.mi.com](https://mimo.mi.com) 控制台 |
| 阿里云 CosyVoice | 音色多、质量高，付费按量 | [阿里云百炼控制台](https://bailian.console.aliyun.com) 获取 DashScope API Key |
| GSV2P | 云端 GPT-SoVITS，接口与本地一致 | [tts.acgnai.top](https://tts.acgnai.top) 获取 Token |

配置步骤：

1. 设置面板 ⚙ → 后台服务 →「云 TTS 配置」：选择后端、填 API Key / Token、选音色（留空用默认）
2. 在「后台服务」列表里启动「云 TTS 桥」（端口 9882）
3. 把聊天设置里的 **TTS 桥地址** 改为 `http://127.0.0.1:9882/tts` 即用云合成；改回 9881 即回到本地 GPT-SoVITS

> 常用音色示例：MiMo `mimo_default`；CosyVoice `cherry`、`longanhuan_v3.6`；GSV2P `原神-中文-派蒙_ZH`。MiMo 可用 `<style>开心</style>` 前缀控制语气。

---

## 第五步：启动

**方式 A（推荐）：安装版 exe / 免安装便携版 zip**

从 GitHub Releases 下载 `MaiBot-Deskpet-Setup-x.x.x.exe`（或免安装版 `MaiBot-Deskpet-Portable-x.x.x-win-x64.zip` 解压运行 `MaiBot Deskpet.exe`），或者在 `deskpet-app` 下执行 `npm run dist` 自行打包。启动后 **STT 桥 / TTS 桥 / 云 TTS 桥 / 快捷键桥 / GPT-SoVITS 由桌宠内置的后台服务管理器统一托管**，不再弹出命令行黑框。

- 服务的状态灯、启动/停止/重启、实时日志都在 **设置面板 ⚙ → 后台服务** 里
- 想看某个服务的原生控制台？勾选该服务的「终端窗口」再重启它
- 桥脚本可复用 MaiBot 的 Python（连上 MaiBot 并人工确认解释器路径后即可使用）；如需指定别的 Python，在「服务路径配置」里填写

**方式 B：源码开发模式（`npm run dev`）**

```bash
cd deskpet-app
npm run dev
```

源码模式同样内置完整的后台服务管理器，所有语音与快捷键桥均可直接在设置面板中启停。

两种方式都需要**启动 MaiBot**（设置面板里的「MaiBot 插件」状态灯会告诉你连上没有）。

> 如果 GPT-SoVITS 没配，本地 TTS 服务会显示"未找到整合包"，不影响文字聊天或云 TTS。

---

## 第六步：测试是否正常

1. 确认桌宠窗口显示角色模型
2. 双击模型弹出输入框，发一条消息
3. 如果 MaiBot 回复了文字，说明**插件通信正常**
4. 如果有 GPT-SoVITS，回复后应有语音朗读
5. 点右下角 🎤 按钮测试语音输入

---

## 常见问题

| 问题 | 解决 |
|------|------|
| `npm install` 失败 | 设置国内镜像或挂代理 |
| `python` 命令找不到 | 重新安装 Python，勾选"Add to PATH" |
| `curl` 无法下载模型 | 用浏览器打开链接手动下载，放到对应目录 |
| 桌宠窗口黑屏 | 检查 `deskpet-app/src/renderer/public/` 里的 Live2D 模型文件 |
| 桌宠没连上 MaiBot | 确认 MaiBot 启动且有加载插件，检查 `config.toml` 端口 |
| TTS 没声音 | 参考音频是否已配置（设置面板 → 服务路径配置），TTS 桥日志里有具体原因 |
| STT 不识别 | `sensevoice/` 目录下两个文件是否齐全 |

---

## 跨设备连接（局域网 / VPN）

> **先分清哪些服务跑在哪台机器**：MaiBot 插件（`plugin.py`）跑在**服务器**上；
> 桌宠客户端及其后台桥（STT / TTS / 热键）跑在**你面前这台电脑（客户端）**上。
> 跨机时只有 **WebSocket 一条链路**要穿过网络；语音识别与语音合成都由客户端在**本机**完成。

### 服务器端（运行 MaiBot 的机器）

在 MaiBot WebUI 插件配置页修改，或编辑插件目录下的 `config.toml`：

```toml
[ws_server]
host = "0.0.0.0"           # 监听所有网卡，允许局域网访问
port = 8523
auth_token = "你的密码"     # 强烈建议设置，否则局域网内任何人都能连
```

开放防火墙端口 **8523**。

> `[tts]` 段**无需**配置桥地址——合成由客户端本地完成，插件不再请求 TTS 桥。
> 其中 `enabled` 仍然有效，表示「是否让桌宠朗读回复」。

### 客户端（运行桌宠的机器）

1. 打开桌宠设置面板（⚙），填写：
   - **WS 地址**：`ws://服务器IP:8523/ws`
   - **WS Token**：服务器端设置的密码
2. **STT 地址保持默认** `http://127.0.0.1:18530/stt` —— 语音识别在**本机**完成，不要指向服务器。
3. **语音合成无需任何配置**：桌宠收到回复后会用本机 TTS 桥（9881 / 9882）自行合成并播放。
   只要在「设置 → 服务」里把本地 TTS 跑起来即可，与是否跨机无关。

### 安全注意事项

- **令牌**：跨机时务必给 `ws_server.auth_token` 设置强随机值。
- **本地桥**：STT（18530）、TTS（9881/9882）与热键桥**全部只监听 `127.0.0.1`**，不对外暴露，
  也不需要任何对外端口——跨机只用到 8523。
- **本机 Python**：MaiBot 上报的解释器路径只会被「本机回环来源」接受，
  因此**客户端需要自己安装 Python**（或在设置面板手动填写 `pythonPath`）来跑本地桥。

---

## 配置项一览

后端插件配置（由 `plugin.py` 中的 `DeskpetPluginConfig` 模板定义，MaiBot 首次加载插件时自动在插件目录生成 `config.toml`，也可在 MaiBot WebUI 中直接配置）：

```toml
[plugin]
enabled = true
config_version = "1.0.6"

[ws_server]
host = "127.0.0.1"       # 本机；跨设备改为 "0.0.0.0"
port = 8523
auth_token = ""           # 留空=不校验连接来源；跨设备或本机多人共用时建议设置强令牌

[chat]
stream_buffer_size = 50

[tts]
enabled = true                 # 是否让桌宠朗读回复（实际合成在桌宠端本地完成）
# url / timeout 已弃用：合成改由桌宠端本地完成，保留字段仅为兼容旧 config.toml
```

前端设置（快捷键 ⚙）：

| 配置项 | 存储位置 | 默认值 |
|--------|---------|--------|
| WS 地址 | localStorage `deskpet/ws-url` | `ws://127.0.0.1:8523/ws` |
| WS Token | localStorage `deskpet/ws-token` | 空 |
| STT 地址 | localStorage `deskpet/stt-url` | `http://127.0.0.1:18530/stt` |
| VAD 灵敏度 | localStorage `deskpet/vad-threshold` | `0.02` |
| 静音判定秒数 | localStorage `deskpet/vad-silence` | `1.5` |


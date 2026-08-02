# MaiBot Deskpet — 完整安装与配置

> 本文档是**完整教程**。快速上手请看根目录 [README](../README.md) 的「快速开始」。

## 目录
- [第零步：MaiBot 配置（必要）](#第零步maibot-配置必要)
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

## 第零步：MaiBot 配置（必要）

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

---

## 第一步：安装插件到 MaiBot

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

> **用安装版 exe 时**：MaiBot 插件目录只需要 `plugin.py`、`_manifest.json`、`config.toml` 三个文件即可——前端和桥脚本都打进安装包了，不需要整仓库。

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

## 第三步：Python 依赖（通常无需手动操作）

STT/TTS 桥直接用 **MaiBot 的 Python 环境** 运行（桌宠连上 MaiBot 后，插件会上报自己的解释器路径）。所需依赖已在 `_manifest.json` 里声明：

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
3. 告诉桌宠整合包在哪（二选一）：
   - **安装版 exe**：设置面板 → 后台服务 → 服务路径配置 → 填「GPT-SoVITS 整合包目录」（常见路径会自动探测，探测到就不用填）
   - **start.bat 启动**：改脚本里的 `GSV_DIR` 一行：`set "GSV_DIR=D:\你的GPT-SoVITS目录"`
4. 配置参考音频（角色声线 `.wav`）和它对应的文本（设置面板 → 服务路径配置）

---

## 第五步：启动

**方式 A（推荐）：安装版 exe**

运行 `deskpet-app` 下的 `npm run dist` 得到 `release/MaiBot-Deskpet-Setup-x.x.x.exe`（或直接用发布的安装包），安装后桌面双击图标即可——**STT 桥 / TTS 桥 / GPT-SoVITS 会随桌宠自动启动**，不再弹一排命令行窗口。

- 服务的状态灯、启动/停止/重启、日志都在 **设置面板 ⚙ → 后台服务** 里
- 想看某个服务的原生控制台？勾选该服务的「终端窗口」再重启它
- SenseVoice 语音识别模型已随包分发，装完即用
- 桥脚本默认复用 MaiBot 的 Python（连上 MaiBot 后自动获得路径）；如需指定别的 Python，在「服务路径配置」里填写

> 自己构建安装包：`npm run dist` 即可产出 NSIS 安装包（语音模型已包含，Python 复用 MaiBot 环境，无需额外组装）。

**方式 B：start.bat（开发 / 跑源码）**

双击 `start.bat`，会弹出 4 个命令行窗口：

| 窗口标题 | 作用 | 必须？ |
|---------|------|--------|
| STT Bridge | 语音识别 | 可选 |
| GPT-SoVITS API | 语音合成 | 可选 |
| TTS Bridge | 文字→语音 | 可选 |
| Deskpet | 桌宠前端 | ✅ 必须 |

两种方式都需要**手动启动 MaiBot**（设置面板里的「MaiBot 插件」状态灯会告诉你连上没有）。

> 如果 GPT-SoVITS 没配，TTS 服务会显示"未找到整合包"，不影响文字聊天。

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

---

## 配置项一览

后端 `config.toml`：

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

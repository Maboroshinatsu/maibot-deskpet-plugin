# MaiBot Deskpet v0.2 — 桌面宠物 Live2D 插件

基于 Electron + Vue3 + PixiJS + Live2D Cubism 4 的 MaiBot 桌面宠物插件，为 MaiBot 提供可交互的 Live2D 角色桌面伴侣。支持本地 TTS 语音合成与实时唇形同步。

## 致谢

本项目受到以下开源项目的启发和帮助：

- **[MaiBot](https://github.com/MaiM-with-u/MaiBot)** — 插件运行的宿主平台，提供消息管线和 AI 推理能力
- **[Airi](https://github.com/moeru-ai/airi)** — PixiJS Live2D 渲染方案的重要参考，包括 `stage.scale` 初始化方式、模型焦点缩放、视线追踪等实现

## 模型资源

项目默认使用 Live2D 官方免费示例模型 **Hiyori (日和)**。你也可以从以下渠道获取更多模型：

- [Live2D 官方示例](https://www.live2d.com/zh-CHS/learn/sample/)
- [imuncle/live2d](https://github.com/imuncle/live2d/tree/master)
- [summerscar/live2dDemo](https://github.com/summerscar/live2dDemo)

将模型文件夹放入 `deskpet-app/src/renderer/public/models/`，然后修改 `src/renderer/services/model-config.ts` 中的 `MODEL_PATH` 即可切换。

## 项目结构

```
maibot-deskpet-plugin/            # git clone 后直接丢进 MaiBot/plugins/
├── README.md
├── _manifest.json                # 插件清单
├── config.toml                   # 运行时配置
├── plugin.py                     # 插件入口（MaiBot MessageGateway）
└── deskpet-app/                  # Electron 前端
    ├── package.json
    ├── electron.vite.config.js
    └── src/
        ├── main/                 # Electron 主进程
        │   └── index.ts
        ├── preload/              # 预加载脚本
        │   └── index.ts
        └── renderer/             # Vue3 渲染进程
            ├── components/       # DeskpetStage, ChatBubble, QuickInput
            ├── composables/      # useWebSocket, useLive2DAnimation
            ├── services/         # Live2D 模型加载, PixiJS 渲染
            ├── stores/           # Pinia 状态管理
            └── public/           # Live2D Cubism 运行时 + 模型文件
```

## 兼容性

- 基于 MaiBot **dev 分支**（1.0.0pre）开发
- 开发环境：MaiBot **1.0.0pre15**
- **仅兼容 MaiBot 1.0.0 及以上版本**，不兼容 0.12.2 及以下版本
- **当前仅在 Windows 上测试通过**，macOS / Linux 理论兼容但未经测试
- **仅支持本地使用**，跨设备远程连接尚未实现

## 功能

- Live2D 角色桌面显示（透明窗口，始终置顶）
- 双向对话：桌宠输入框 → MaiBot 消息管线 → LLM 响应 → 气泡回复
- WebSocket 实时通信（端口 8523）
- 模型交互：滚轮缩放（鼠标焦点）、拖拽平移（窗口内自由移动）
- 视线追踪：角色眼睛跟随鼠标指针，支持窗口外全局鼠标追踪
- 桌面窗口交互：底部导航条拖动窗口、窗口位置/大小持久化、最小尺寸保护
- 布局持久化：模型缩放、模型偏移、窗口位置和窗口大小自动保存与恢复
- 托盘控制：显示/隐藏、置顶、锁定穿透、重置模型位置、重置窗口位置、重置全部布局
- 悬停淡化模型：可通过托盘开启，方便临时查看/操作模型遮挡区域
- 情绪/动画触发：MaiBot 可通过 Tool 控制角色表情和动作
- 本地 TTS 语音合成：基于 Piper TTS，离线可用（zh_CN-huayan-medium 中文模型）
- 实时唇形同步：Web Audio API 分析音量驱动 ParamMouthOpenY
- 自定义应用图标：托盘和窗口图标使用 `public/icon.png`

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 34 + electron-vite |
| 前端 | Vue 3.5 + Pinia + TypeScript |
| 2D 渲染 | PixiJS 6 + pixi-live2d-display (Cubism 4) |
| 后端通信 | WebSocket (websockets Python) |
| AI 接入 | MaiBot MessageGateway 插件协议 |

## 安装与运行

### 1. 安装插件

将仓库根目录（包含 `plugin.py`, `_manifest.json`, `config.toml`）放入 MaiBot 的 `plugins/maibot-deskpet-plugin/` 文件夹。

### 2. 安装前端依赖

```bash
cd deskpet-app
npm install
```

> 如遇 Electron 下载失败，设置镜像：
> ```bash
> ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
> ```

### 3. 启动开发模式

```bash
npm run dev
```

### 4. 安装 Piper TTS（可选，用于语音合成）

下载 [Piper Windows 发行版](https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip)，解压到 `deskpet-app/piper/piper/`。

下载中文语音模型：

```
https://hf-mirror.com/rhasspy/piper-voices/resolve/v1.0.0/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx
https://hf-mirror.com/rhasspy/piper-voices/resolve/v1.0.0/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json
```

放入 `deskpet-app/piper/piper/`，与 `piper.exe` 同级。

> 不安装 Piper 时，Maibot 回复不会朗读，其他功能不受影响。

### 5. 构建生产版本

```bash
npm run build
```

## 跨设备连接（局域网 / VPN）

桌宠前端（Electron）可以运行在一台电脑上，通过网络连接到**另一台电脑**上运行的 MaiBot。典型场景：

- 服务器（台式机/笔记本）运行 MaiBot + 插件
- 本地（笔记本/平板）运行桌宠前端，享受 Live2D 交互
- 两者在同一局域网或通过 VPN 互联

### 1. 服务器端设置

在运行 MaiBot 的机器上编辑 `plugins/maibot-deskpet-plugin/config.toml`：

```toml
[ws_server]
host = "0.0.0.0"            # 监听所有网络接口（默认 127.0.0.1 仅本机）
port = 8523                  # WebSocket 端口
auth_token = "你的密码"      # 强烈建议设置，防止未授权连接
```

### 2. 开放防火墙端口

需要在服务器端允许外部访问 8523 端口：

**Windows（PowerShell 管理员）：**

```powershell
New-NetFirewallRule -DisplayName "MaiBot Deskpet WS" -Direction Inbound -LocalPort 8523 -Protocol TCP -Action Allow
```

**Linux（ufw）：**

```bash
sudo ufw allow 8523/tcp
```

### 3. 获取服务器 IP 地址

在服务器上查看局域网 IP：

**Windows：**

```powershell
ipconfig | findstr IPv4
```

**Linux：**

```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

通常会看到类似 `192.168.1.100` 或 `10.0.0.5` 的地址。

### 4. 客户端设置

在运行桌宠的机器上：

1. 启动桌宠 `npm run dev`
2. 按 `F12` 打开 DevTools 控制台
3. 输入以下命令配置连接：

```js
// 设置服务器地址（替换为实际 IP）
localStorage.setItem('deskpet/ws-url', 'ws://192.168.1.100:8523/ws')

// 如果服务器端设置了 auth_token
localStorage.setItem('deskpet/ws-token', '你的密码')
```

4. 按 `Ctrl+R` 刷新页面，桌宠将连接到远程 MaiBot

### 5. 验证连接

服务器端 MaiBot 日志应显示：

```text
[Deskpet] Client authenticated: ('192.168.x.x', xxxxx)
[Deskpet] Client connected: ('192.168.x.x', xxxxx)
```

客户端发一条消息，服务器端应出现 `[Deskpet] User input: ...`。

### 6. 恢复本地连接

如果之后想切回本机连接：

```js
localStorage.removeItem('deskpet/ws-url')
localStorage.removeItem('deskpet/ws-token')
```

刷新即可恢复默认的 `ws://127.0.0.1:8523/ws`。

### 7. 常见问题

| 问题 | 可能原因 |
|------|----------|
| 连接不上，控制台无日志 | 防火墙未开放 / IP 地址错误 / MaiBot 未启动 |
| 连接后立刻断开 | auth_token 不匹配 |
| 能连接但消息无回复 | MaiBot 插件未加载 / gateway 未就绪 |
| VPN 下无法连接 | VPN 可能隔离了局域网，尝试用 VPN 分配的 IP |

## 配置

编辑 `config.toml`：

```toml
[plugin]
enabled = true
config_version = "1.0.0"

[ws_server]
host = "127.0.0.1"       # 仅本机连接；跨设备改为 "0.0.0.0"
port = 8523
auth_token = ""           # 跨设备时建议设置密码

[chat]
stream_buffer_size = 50
```

## 更新日志

### v0.2.0 — TTS + 唇形同步 + 表情系统

- [x] 本地 TTS 语音合成（Piper TTS，zh_CN-huayan-medium，离线推理）
- [x] 实时唇形同步（Web Audio API → ParamMouthOpenY，快攻慢退算法）
- [x] 表情状态机（自动恢复 neutral，可配置持续时间）
- [x] 动作优先级系统（Idle / Reply / Interaction 三层，低优先级不打断高优先级）
- [x] 空闲动画调度器（25s 无交互后随机播放 idle 动作）
- [x] Store 拆分（deskpet / chat 分离）
- [x] Composable 重构（useWindowDrag / useModelZoom / useModelDrag / useExpressionState / useMotionPriority / useIdleScheduler / useLipSync）
- [x] Transport Adapter 抽象（input:text 协议，为 maim_message 预留）

### v0.1.1 — 桌宠交互增强

- [x] 全局鼠标追踪：窗口外也能让 Live2D 视线跟随鼠标
- [x] 模型布局持久化：缩放和窗口内偏移自动保存/恢复
- [x] 窗口布局持久化：位置和大小自动保存/恢复
- [x] 托盘菜单增强：显示/隐藏、置顶、锁定穿透、重置模型、重置窗口、重置全部布局
- [x] 锁定穿透提示：托盘文案提示当前穿透状态
- [x] 悬停淡化模型：便于临时查看模型遮挡区域
- [x] 组件拆分：抽出 ChatBubble / QuickInput，降低 DeskpetStage 复杂度
- [x] Transport Adapter 初步抽象：为后续接入 maim_message / MaiBot 原生平台预留接口
- [x] 自定义图标：托盘和窗口图标使用 public/icon.png

### v0.1.0 — 初始版本

- [x] Live2D 角色透明窗口渲染（PixiJS + Cubism 4）
- [x] MaiBot MessageGateway 双向消息管线集成
- [x] 滚轮缩放（鼠标焦点）、拖拽平移、视线追踪
- [x] 窗口拖动（底部导航条）、双击输入框
- [x] 渐变半透明边框（hover 显示）
- [x] WebSocket 通信协议
- [x] Tool 组件：set_deskpet_emotion / trigger_deskpet_animation / send_deskpet_bubble

## 未来计划

### v0.3 — 感官扩展
- [ ] STT 语音识别输入
- [ ] 浏览器内置 TTS 中文语音回退
- [ ] 表情包系统集成
- [ ] 鼠标指针追踪优化（头部/身体跟随，类似 Airi）

### v0.4 — 多模型 & 兼容性
- [ ] Cubism 2/3/4 模型兼容性验证
- [ ] VRM 3D 模型支持（参考 Airi Three.js 方案）
- [ ] GPU 兼容性改进（DirectComposition 降级方案）
- [ ] 窗口尺寸记忆与恢复

### v0.5 — 进阶功能
- [ ] 多显示器支持
- [ ] 屏幕感知（计算机视觉）
- [ ] 桌宠间互动
- [ ] 插件市场集成

## 许可

[GPL-3.0](LICENSE)

本项目作为 MaiBot 的插件，遵循与 MaiBot 相同的 GPL-3.0 许可证。

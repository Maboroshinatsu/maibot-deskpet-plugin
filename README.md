# MaiBot Deskpet v0.1 — 桌面宠物 Live2D 插件

基于 Electron + Vue3 + PixiJS + Live2D Cubism 4 的 MaiBot 桌面宠物插件，为 MaiBot 提供可交互的 Live2D 角色桌面伴侣。

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

### 4. 构建生产版本

```bash
npm run build
```

## 配置

编辑 `config.toml`：

```toml
[plugin]
enabled = true
config_version = "1.0.0"

[ws_server]
host = "127.0.0.1"
port = 8523

[chat]
stream_buffer_size = 50
```

## 更新日志

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

### v0.2 — 交互增强
- [ ] 鼠标指针追踪优化（头部/身体跟随，类似 Airi）
- [ ] 聊天气泡智能定位（避免遮挡角色）
- [ ] 更多角色动画（空闲随机动作、点击反应）
- [ ] 设置 UI 菜单（模型切换、缩放、置顶开关）
- [ ] 模型文件快速替换入口

### v0.3 — 感官扩展
- [ ] TTS 语音合成播报
- [ ] STT 语音识别输入
- [ ] 唇形同步（ParamMouthOpenY + 音频分析）
- [ ] 表情包系统集成

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

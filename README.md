<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-light.png" />
  <img alt="MaiBot Deskpet v1.0.0 Hero Banner" src="docs/assets/hero-light.png" width="100%" />
</picture>

<br />

[![Release](https://img.shields.io/badge/Release-v1.0.8-c87137?style=flat-square&labelColor=231d19)](https://github.com/Maboroshinatsu/maibot-deskpet-plugin/releases/tag/v1.0.8)
[![Installer](https://img.shields.io/badge/Setup.exe-85.2_MB-2a7b4c?style=flat-square&labelColor=231d19)](https://github.com/Maboroshinatsu/maibot-deskpet-plugin/releases/download/v1.0.8/MaiBot-Deskpet-Setup-1.0.8.exe)
[![Portable](https://img.shields.io/badge/Portable.zip-124.9_MB-3b82f6?style=flat-square&labelColor=231d19)](https://github.com/Maboroshinatsu/maibot-deskpet-plugin/releases/download/v1.0.8/MaiBot-Deskpet-Portable-1.0.8-win-x64.zip)
[![Electron](https://img.shields.io/badge/Electron_34-Vue_3_+_TS-5c7cfa?style=flat-square&labelColor=231d19)](https://www.electronjs.org/)
[![Live2D](https://img.shields.io/badge/Live2D-Cubism_2_/_4-d66853?style=flat-square&labelColor=231d19)](https://www.live2d.com/)
[![MaiBot](https://img.shields.io/badge/MaiBot-Plugin_SDK_v2-8b6fd4?style=flat-square&labelColor=231d19)](https://github.com/MaiM-with-u/MaiBot)
[![License](https://img.shields.io/badge/License-MIT-e08b52?style=flat-square&labelColor=231d19)](LICENSE)

**[下载安装包](https://github.com/Maboroshinatsu/maibot-deskpet-plugin/releases/tag/v1.0.8)** &nbsp;·&nbsp; **[使用指南](docs/GUIDE.md)** &nbsp;·&nbsp; **[部署配置](docs/SETUP.md)** &nbsp;·&nbsp; **[模型适配规范](docs/MODEL-ADAPTER-SPEC.md)** &nbsp;·&nbsp; **[v1.0 更新日志](docs/UPGRADE-AND-FIX-LOG-2026-10-12.md)**

</div>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bento-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/bento-light.svg" />
  <img alt="MaiBot Deskpet Core Features" src="docs/assets/bento-light.svg" width="100%" />
</picture>

---

## 快速开始

**1. 安装桌面端**  
前往 [**Releases**](https://github.com/Maboroshinatsu/maibot-deskpet-plugin/releases/tag/v1.0.8) 下载并运行安装版 **`MaiBot-Deskpet-Setup-1.0.8.exe`**，或下载免安装便携版 **`MaiBot-Deskpet-Portable-1.0.8-win-x64.zip`** 解压即用。

**2. 接入 MaiBot 插件**  
将本仓库克隆至 MaiBot 的 `plugins/` 目录，重启 MaiBot 即可自动监听 `127.0.0.1:8523`：
```bash
cd /path/to/MaiBot/plugins
git clone https://github.com/Maboroshinatsu/maibot-deskpet-plugin.git maibot_deskpet_plugin
```

**3. 配置语音（可选）**  
右键桌宠打开 **「设置 → 服务」**：
- **TTS 语音合成**：支持阿里云百炼、硅基流动、Fish Audio、小米 MiMo、自定义 OpenAI 兼容接口及本地 GPT-SoVITS。
- **STT 语音识别**：默认使用云端硅基流动 SenseVoice（免费极速、零体积）；也可切换为本地 SenseVoice INT8（首次启用自动按需下载 `226 MB` 模型）。

---

## 💡 v1.0.8 最新改进与修复

本版本修好了几处「数据会丢、声音会乱」的毛病：

- 💾 **聊天记录关窗不再丢**：以前收到回复后马上关掉桌宠，最后一条消息可能没来得及存下来。现在关窗前会先把记录写完再退出，稳了。
- 🛡️ **聊天记录不会整份损坏**：记录文件改成「先写临时文件、再一次性替换」，即使写入过程中断电或强杀，下次打开也不会把历史记录全部清空。
- 🔀 **多段回复的语音不再乱序**：当 MaiBot 把一段话分成几条短消息发来时，语音会严格按先后顺序播完一段再播下一段，不再出现短句抢在前面的情况。
- 🚫 **不再念出表情包标记**：修复了回复里夹带「表情包: …」这类标记时，桌宠把它当台词念出来的问题。

---

## 文档导航

| 文档 | 说明 |
| :--- | :--- |
| [**《使用与进阶指南》**](docs/GUIDE.md) | 语音服务详细对比、系统架构图、交互快捷键速查、源码构建与目录结构 |
| [**《部署与配置指南》**](docs/SETUP.md) | 插件端 `config.toml` 配置、局域网跨设备连接与常见问题排障 |
| [**《Live2D 模型适配规范》**](docs/MODEL-ADAPTER-SPEC.md) | 自定义模型导入、能力清单导出与 AI 辅助生成 `deskpet-adapter.json` |
| [**《v1.0.0 升级与修复记录》**](docs/UPGRADE-AND-FIX-LOG-2026-10-12.md) | v1.0.0 架构重构、状态机修复与轻量化分发演进归档 |

---

## 致谢

- **[MaiBot](https://github.com/MaiM-with-u/MaiBot)** — 插件运行的宿主平台
- **[Airi](https://github.com/moeru-ai/airi)** — PixiJS Live2D 渲染方案的重要参考
- **[NachoBot](https://github.com/RachelForster/Shinsekai)** — GPT-SoVITS 集成方案与音频处理管线参考
- **[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)** — 语音合成引擎
- **[Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx)** — SenseVoice 语音识别运行时
- **[NapCat](https://github.com/NapNeko/NapCatQQ)** — 图片消息格式参考
- **[pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)** — PixiJS Live2D 渲染封装库

---

## 开源协议与素材声明

- **项目源码**：本仓库所有自研代码与静态立绘示例包（`sample_static`）均基于 [MIT License](LICENSE) 开源。
- **Live2D Web 运行时**：`live2dcubismcore.min.js`（Live2D Cubism SDK for Web 核心脚本）版权归 **Live2D Inc.** 所有，依据 [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 随本项目分发，不包含在 MIT 源码协议授权范围内。
- **默认示例模型「桃濑日和 (Hiyori Momose / 桃瀬ひより)」**：为 Live2D Inc. 提供的示例素材（Live2D 原创角色），版权归 **Live2D Inc.** 所有，依据 [Live2D Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 与 [《Live2D Cubism 素材样本的使用授权要求》](https://www.live2d.com/zh-CHS/learn/sample/model-terms/) 使用与分发，不包含在 MIT 源码协议授权范围内。
  - 本仓库仅随包分发该模型的**运行时输出文件**（`.moc3`、贴图与动作/物理等 `.json`），不含 Cubism Editor 源工程文件（`.cmo3` / `.can3`）。
  - 依协议要求标注：**「本作品的角色在运用株式会社Live2D的著作物素材样本时依据了株式会社Live2D规定的协议。本作品完全根据制作者的自我裁量制作而成。」**

---

## Privacy Policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.
- By default, the desktop companion connects only to the user's local MaiBot WebSocket endpoint (`ws://127.0.0.1:8523/ws`).
- No telemetry, analytics, or background tracking is collected or transmitted. External network requests (such as cloud STT/TTS API calls or optional local ASR model downloads) occur strictly when explicitly configured and triggered by the user.

All official Windows release binaries are built reproducibly from source via [GitHub Actions](.github/workflows/release.yml).


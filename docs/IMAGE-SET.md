# 静态立绘模式（无需 Live2D 模型）

> 不想用 Live2D 模型？桌宠也可以用**一组 PNG/SVG 图片**当角色，情绪变化时自动换图。

## 快速上手

在 `deskpet-app/src/renderer/public/models/` 下建一个文件夹，放一份 `deskpet-images.json` 清单和几张图片（png/jpg/webp/svg）即可：

```text
models/my_char/
├── deskpet-images.json
├── neutral.png
├── happy.png
├── sad.png
└── talk.png
```

设置面板「显示」区有 **Live2D / 静态立绘** 分段开关，两类模型随时互切，无需重启。

## 清单格式

```jsonc
// deskpet-images.json（内置完整示例见 models/sample_static/）
{
  "name": "展示名（可选）",
  "default": "neutral",            // 标定的默认表情：情绪 6 秒自动回退到这里
  "images": {                      // 情绪名 → 图片文件
    "neutral": "neutral.png",
    "happy": "happy.png"
  },
  "talk": "talk.png",              // 可选：TTS 说话时的差分图
  "idleEmotions": ["happy", "curious"],  // 可选：待机随机情绪池；缺省 = 全部非默认键；[] = 关闭
  "idleIntervalSec": [12, 25]      // 可选：待机随机情绪的间隔范围（秒）
}
```

### 字段说明

- **`default`（标定默认表情）**：未映射情绪回落 + 情绪 6 秒自动回退的目标。不写则按 `normal` → `neutral` → 第一张图回落（会在控制台提醒标定）。
- **`idleEmotions` / `idleIntervalSec`（待机随机）**：无交互一段时间后，从池子里随机展示一张约 3.5 秒再回来；说话/思考/新情绪到达时立即让位。
- **`talk`（说话差分）**：TTS 出声时显示这张图，说完回到当前情绪图。

### 支持的情绪名

与 Live2D adapter 一致：`happy` `sad` `angry` `surprise` `embarrassed` `thinking` `shy` `curious` `confused` `neutral` `idle`，没映射的情绪显示 `default` 图。

### 自定义情绪

`images` 的键不限于上面这 11 种——你写 `"wink": "wink.png"` 就是一种新情绪。清单加载后桌宠会把全部情绪键上报给插件，AI 通过 `set_deskpet_emotion` 工具即可使用（Live2D adapter 的 `emotions` 键同理）。自动情绪推断（按回复文本猜情绪）只覆盖内置词表，自定义情绪由 AI 主动调用工具触发。

### 特效

- **交叉淡入淡出**：换图时双槽过渡，避免白闪
- **VN 风小跳**：换表情时的 squash & stretch 弹跳
- **待机呼吸 / 思考点头**：常驻微动效

右键点击桌宠可循环切换当前模型的情绪（6 秒后自动回默认表情）。

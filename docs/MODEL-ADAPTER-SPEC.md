# MaiBot Deskpet — Live2D 模型适配规范 v1

> **这份文档是给 AI 看的。**
> 想让自己的 Live2D 模型响应桌宠的情绪和动作，你不需要懂代码：
> 把**这份文档全文** + **[能力清单](#第一步导出模型能力清单)** 一起发给任意 AI（Claude / ChatGPT / DeepSeek 均可），
> 让它生成 `deskpet-adapter.json`，放进模型目录即可。
>
> 提示词可以直接用：
> *"这是 MaiBot Deskpet 的模型适配规范和我模型的能力清单，请按规范为我的模型生成 deskpet-adapter.json，只输出 JSON。"*

---

## 为什么需要适配

桌宠向模型下达的是**抽象指令**（"开心""挥手"），而每个 Live2D 模型的图层、参数命名、动作分组都是作者自己定的：

| | Hiyori（官方示例） | ariu（VTube Studio 模型） |
|---|---|---|
| 动作组 | `Idle` `Tap` `Flick` `FlickUp`… 7 组 | **没有任何动作组** |
| 表情 | 没有注册表情 | 目录里有 10 个 `.exp3.json`，但**都没注册**进 `model3.json` |
| 微笑参数 | `ParamEyeLSmile` / `ParamEyeRSmile` | 不存在，只有 `ParamMouthForm` |
| 脸红参数 | `ParamCheek` | 不存在 |
| 自定义参数 | — | `aixin`（爱心眼）`qqy`（圈圈眼）`heilian`（黑化） |

所以适配层不可能内置。`deskpet-adapter.json` 就是这张翻译表：**桌宠语义 → 你这个模型的具体表情/动作/参数**。

没有这个文件模型照样能加载、能跟随视线、能口型同步，只是不会响应情绪和动作指令。

### ⚠️ 一个必须知道的坑

Cubism 运行时对**不存在的参数 ID 是静默接受**的 —— 写进去不报错、也没有任何效果。
动作组名写错同样只是静默不播。所以**适配写错的表现是"完全没反应"，而不是报错**。

正因为如此，桌宠内置了加载时校验（见[第四步](#第四步校验)）。**别靠肉眼调试，一定要看校验报告。**

---

## 第一步：导出模型能力清单

这是整个流程最关键的一步，也是唯一必须在桌宠里做的操作。

**为什么必须这样做**：参数 ID 存在 `.moc3` 二进制文件里。`.cdi3.json` 会列出参数清单，但它是**可选文件**，很多模型（包括 ariu）根本没有。所以光靠读模型文件，AI 无法可靠地知道你的模型有哪些参数 —— 必须从运行时拿。

1. 把模型文件夹放进 `deskpet-app/src/renderer/public/models/`
2. 启动桌宠，在设置面板（⚙ → 显示 → Live2D 模型）里选中你的模型
3. 按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> 打开开发者工具，切到 Console
4. 输入并回车：

```js
deskpetInspectModel()
```

5. 复制输出的 JSON。它长这样：

```jsonc
{
  "modelUrl": "./models/your_model/your_model.model3.json",
  "motionGroups": { "Idle": 3, "Tap": 2, "Flick": 1 },   // 组名: 该组动作条数
  "expressions": ["smile", "angry"],                      // 已注册的表情名
  "parameters": [                                         // 真实存在的参数
    { "id": "ParamAngleX",     "min": -30, "max": 30, "default": 0 },
    { "id": "ParamMouthForm",  "min": -1,  "max": 1,  "default": 0 },
    { "id": "ParamMouthOpenY", "min": 0,   "max": 1,  "default": 0 }
  ]
}
```

**只有出现在这份清单里的名字才能写进 adapter。** 这是硬约束。

---

## 第二步：文件位置与格式

文件名固定为 `deskpet-adapter.json`，放在**与 `.model3.json` 同一个目录**：

```
public/models/your_model/
├── your_model.model3.json
├── your_model.moc3
└── deskpet-adapter.json      ← 放这里
```

### 完整字段说明

```jsonc
{
  "version": 1,                      // 必填，固定为 1
  "modelId": "your_model",           // 选填，标识用
  "name": "角色名",                   // 选填，日志里显示

  // ── 待机动作 ──────────────────────────────
  // 选填。空闲一段时间后随机播放其中一个组。
  // 不写则按组名猜（含 idle/neutral/normal/stand/wait 的组）。
  // 模型没有动作组就留空数组。
  "idleMotions": ["Idle"],

  // ── 口型同步 ──────────────────────────────
  // 选填。默认 { "mouthOpenParam": "ParamMouthOpenY", "gain": 1 }
  // 你的模型张嘴参数不叫这个名字时**必须**声明，否则说话时嘴不动。
  "lipSync": {
    "mouthOpenParam": "ParamMouthOpenY",
    "gain": 1.0                      // 幅度缩放，0.1~4；嘴张太大就调小
  },

  // ── 情绪映射 ──────────────────────────────
  // 内置情绪键（可以只写一部分）：
  //   happy sad angry surprise embarrassed thinking shy curious confused neutral idle
  // 也接受自定义键（如 "wink"）：桌宠会把你声明的键上报给插件，
  // AI 之后就能用 set_deskpet_emotion 触发它
  "emotions": {
    "happy": {
      "expression": "smile",         // 选填，必须是 expressions 清单里的名字
      "motion": { "group": "Tap", "index": 1 },   // 选填，index 默认 0
      "parameters": {                // 选填，参数 ID → 目标值
        "ParamMouthForm": 1
      }
    }
  },

  // ── 语义动作映射 ──────────────────────────
  // 键必须是这 8 个之一，可以只写一部分：
  //   wave jump spin sit sleep wake dance cheer
  // 只支持 motion（动作组），没有动作组的模型整段留空 {}
  "animations": {
    "wave": { "motion": { "group": "Tap", "index": 1 } }
  }
}
```

### 三种映射手段的取舍

| 手段 | 前提 | 效果 | 说明 |
|---|---|---|---|
| `expression` | 表情已注册进 `model3.json` 的 `Expressions` | 最好，有淡入淡出 | 见[常见坑 1](#1-exp3-文件存在但用不了) |
| `motion` | 模型有 `Motions` 动作组 | 最生动，全身动作 | 播放期间内置眨眼会暂停（Cubism 标准行为） |
| `parameters` | 参数在清单里 | 保底方案，静态定格 | 任何模型都能用 |

**没有动作组也没有注册表情的模型（这很常见）** → 只用 `parameters` 也能做出可辨识的情绪，见下面的极简示例。

### 关于取值范围

`parameters` 的值会被钳制到模型声明的 `[min, max]`。写超了不报错，但校验会警告。
按清单里的 `min`/`max` 取值：想"完全张开"就写 `max`，想"回归默认"就写 `default`（通常是 0）。

### 关于恢复默认

非中性情绪会在 **6 秒后自动切回 `neutral`**。所以：

- **强烈建议配置 `neutral`**，把其他情绪用到的参数都在这里显式归零/复位，否则表情会残留。
- 桌宠会自动把"上一次设过、这次没设"的参数写回 0，但显式声明 `neutral` 更可控。
- `expression` 不需要（也没法）用参数去抵消：切到不带 `expression` 的情绪（含 `neutral`）时，桌宠会自动把上一个表情淡出。

---

## 第三步：映射建议

9 种情绪的语义，以及在只有参数可用时的通用做法（参数名请替换成你模型清单里的真实 ID）：

| 情绪 | 语义 | 常见参数做法 |
|---|---|---|
| `happy` | 开心、笑 | 嘴角上扬（`ParamMouthForm` 正向）、眼睛微笑参数、脸红 |
| `sad` | 难过、失落 | 嘴角下压（负向）、眉毛下垂（`ParamBrow*Y` 负向）、眼睛半闭 |
| `angry` | 生气、不满 | 眉毛内压（`ParamBrow*Angle`/`*Form`）、嘴角下压 |
| `surprise` | 惊讶 | 眼睛睁大（`ParamEye*Open` 取 max）、嘴张开 |
| `thinking` | 思考、犹豫 | 眉毛微抬、视线偏移、嘴形中性 |
| `shy` | 害羞 | 脸红 max、眼睛微笑、嘴角轻扬 |
| `curious` | 好奇、疑问 | 单侧眉抬、头微倾（`ParamAngleZ`） |
| `neutral` | 中性（**复位用**） | 把上面所有参数写回 default |
| `idle` | 待机 | 通常与 `neutral` 相同 |

8 种语义动作：`wave` 挥手、`jump` 跳跃、`spin` 转身、`sit` 坐下、`sleep` 睡觉、`wake` 醒来、`dance` 跳舞、`cheer` 欢呼。
模型的动作组通常是 `Tap` / `Flick` 这类交互命名而非语义命名 —— **凭观感就近映射即可**，多个语义动作复用同一个组完全没问题。

### 极简示例：没有动作组、没有注册表情的模型

```jsonc
{
  "version": 1,
  "name": "示例角色",
  "idleMotions": [],
  "lipSync": { "mouthOpenParam": "ParamMouthOpenY", "gain": 1 },
  "emotions": {
    "happy":    { "parameters": { "ParamMouthForm": 1,    "ParamBrowLY": 0.3, "ParamBrowRY": 0.3 } },
    "sad":      { "parameters": { "ParamMouthForm": -1,   "ParamBrowLY": -0.5, "ParamBrowRY": -0.5 } },
    "angry":    { "parameters": { "ParamMouthForm": -0.7, "ParamBrowLForm": -1, "ParamBrowRForm": -1 } },
    "surprise": { "parameters": { "ParamEyeLOpen": 1,     "ParamEyeROpen": 1, "ParamMouthOpenY": 0.8 } },
    "neutral":  { "parameters": { "ParamMouthForm": 0,    "ParamBrowLY": 0, "ParamBrowRY": 0,
                                  "ParamBrowLForm": 0,    "ParamBrowRForm": 0 } }
  },
  "animations": {}
}
```

完整参考实现见仓库里 Hiyori 的适配文件：
`deskpet-app/src/renderer/public/models/hiyori_pro_zh/hiyori_pro_zh/runtime/deskpet-adapter.json`

---

## 第四步：校验

把 `deskpet-adapter.json` 放好后，在桌宠里**重新选一次该模型**（或按 <kbd>Ctrl</kbd>+<kbd>R</kbd> 重载），
然后看开发者工具 Console。

**通过时：**

```
[Deskpet] Adapter 校验通过：角色名（情绪 9 项，动作 8 项）
```

**有问题时**会逐条列出，例如：

```
[Deskpet] Adapter 校验：角色名
  ✗ emotions.shy: 参数 "ParamCheek" 在该模型里不存在（写入会被静默丢弃）
  ✗ emotions.happy: 动作组 "Tap" 不存在，可用的组：Idle, Motion01
  ✗ animations.wave: 动作组 "Idle" 只有 3 条动作，index 5 越界
  ✗ emotions.angry: 表情 "mad" 用不了 —— 该模型的 .model3.json 里没有 Expressions 段
  ! emotions.sad: 参数 "ParamMouthForm" 的值 -2 超出模型范围 [-1, 1]，会被钳制
  ! lipSync.mouthOpenParam: 参数 "ParamMouthOpenY" 在该模型里不存在，口型同步不会有效果
```

把报错原文再发给 AI 让它修正即可。校验器只检查"名字和范围对不对"，**观感好不好还得你自己看** ——
在 Console 里逐项预览（走的是与真实指令完全相同的代码路径）：

```js
deskpetTestEmotion('happy')     // 预览情绪，6 秒后自动回 neutral
deskpetTestEmotion('shy')
deskpetTestAnimation('wave')    // 预览语义动作
```

传了没映射的名字会直接告诉你，不会静默没反应。
也可以直接跟麦麦说"你现在很生气"，看它调用工具后的表现。

---

## 常见坑

### 1. exp3 文件存在但用不了

VTube Studio 导出的模型经常是这样：目录里一堆 `.exp3.json`，但 `.model3.json` 里**没有 `Expressions` 段**。
这种情况下 `expression` 字段一律无效（校验会明确报出来）。

两个选择：

- **改用 `parameters`**：打开那个 `.exp3.json`，把里面的参数 ID 和值直接抄进 `parameters`。
  例如 `爱心眼.exp3.json` 内容是 `{"Id": "aixin", "Value": 1.0}` → 写 `"parameters": { "aixin": 1 }`。
  ⚠️ 但要确认 `aixin` 出现在能力清单里（自定义参数通常在）。
- **注册进 model3.json**：在 `FileReferences` 里加一段（注意 `Name` 是你之后在 adapter 里引用的名字）：

  ```jsonc
  "FileReferences": {
    "Moc": "...", "Textures": [ ... ],
    "Expressions": [
      { "Name": "aixin", "File": "爱心眼.exp3.json" },
      { "Name": "heilian", "File": "黑化.exp3.json" }
    ]
  }
  ```

### 2. 动作组名大小写敏感

`Idle` ≠ `idle`。必须与能力清单里的 `motionGroups` 键名完全一致。

### 3. index 从 0 开始

`"motionGroups": { "Tap": 2 }` 意味着合法 index 只有 `0` 和 `1`。

### 4. 眨眼 / 呼吸不用管

桌宠使用 Cubism 内置的眨眼和呼吸系统，**不要在 adapter 里写 `ParamEyeLOpen` 之类的持续动画**。
眨眼依赖 `.model3.json` 的 `Groups` 里的 `EyeBlink` 声明：

```jsonc
"Groups": [
  { "Target": "Parameter", "Name": "EyeBlink", "Ids": ["ParamEyeLOpen", "ParamEyeROpen"] },
  { "Target": "Parameter", "Name": "LipSync",  "Ids": ["ParamMouthOpenY"] }
]
```
没有 `EyeBlink` 组的模型不会自动眨眼 —— 补上这段即可（这是改模型文件，不是改 adapter）。

在 `surprise` 里把 `ParamEye*Open` 设成 max 是可以的（一次性定格），内置眨眼下一次会接管回去。

### 5. 参数改了没反应

大概率是名字写错 —— 回到[第一步](#第一步导出模型能力清单)重新导出清单核对。记住：**错的参数名不会报错**。

---

## 附：JSON Schema

`docs/deskpet-adapter.schema.json` 提供了机器可校验的 schema，可在编辑器里加一行引用获得自动补全：

```jsonc
{
  "$schema": "../../../../../../docs/deskpet-adapter.schema.json",
  "version": 1
}
```

（`$schema` 字段会被桌宠忽略，路径按你的模型目录层级调整；不加也完全没问题。）

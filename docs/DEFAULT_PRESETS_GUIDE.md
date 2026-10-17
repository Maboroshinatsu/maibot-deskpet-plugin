# Live2D 通用状态预设使用与调优说明

## 概览
本次更新对桌宠内置的 12 个默认状态预设进行了系统性重构与视觉实机调优：
1. **非线性三次平滑缓入缓出（`easeInOutCubic`）**：彻底替换原有线性或机械起步的补间逻辑，运动起步与刹停两端速度均为 0（S 型过渡曲线），无论是手调滑块还是预设播放均丝滑无顿挫感。
2. **黄金节奏收拢（0.6s 过渡 + 1.0s 停留 + 2.0s 归位）**：依据实机调优手感，将关键帧过渡时长收拢为舒适黄金期 **0.6 秒（600ms）**，关键帧动作进入峰值后的停留时间保持 **1.0 秒（1000ms）**，归位时间保持 **2.0 秒（2000ms）**，既舒缓沉稳又灵动不拖沓。
3. **开心神态对标 Miku 欢呼黄金预设**：全面汲取用户手调的金标准，采用**明眸大眼（EyeOpen: 1.0）+ 笑意卧蚕弧度（EyeSmile: 0.85）+ 开怀大张笑嘴（MouthOpenY: 0.55）+ 欢欣扬眉（BrowY: 0.45）+ 微仰头**，彻底解决以往眼睛半睁不睁、神态诡异死板的问题，元气满满。
4. **结构性防崩**：眼球移动幅度限制在安全范围（±0.25~0.28），头部歪斜联动身体同向倾斜（杜绝折颈），并过滤外部手持武器道具。

所有预设已在本地运行环境 `D:\Frankenstein\exetest\MaiBot Deskpet` 中实机部署完成，开箱即用。

---

## 12 个通用状态预设列表

| 预设标识 (ID) | 状态名称 | 情绪类型 | 节奏设定 | 动作与神态特征 |
| :--- | :--- | :--- | :--- | :--- |
| `neutral` | 平常 | neutral | 过渡 600ms / 保持 | 舒展自然的基础待机状态 |
| `happy` | 开心·欢呼 | happy | 过渡 600ms / 停留 1000ms / 归位 2000ms | 对标 Miku 欢呼预设：明眸大眼、扬眉大笑开颜、微仰头与卧蚕甜笑，开朗元气 |
| `happy_tilt` | 开心歪头笑 | happy | 过渡 600ms / 停留 1000ms / 归位 2000ms | 头部微侧（配合身体同向倾斜），明朗大眼与甜美笑容 |
| `sad` | 委屈 | sad | 过渡 600ms / 停留 1000ms / 归位 2000ms | 嘴角自然向下微垂，双眉微蹙，眼神微含委屈 |
| `sad_glance` | 委屈撇目 | sad | 过渡 600ms / 停留 1000ms / 归位 2000ms | 略微侧视、抿唇低语，神态惹人怜爱 |
| `angry` | 气呼呼 | angry | 过渡 600ms / 停留 1000ms / 归位 2000ms | 嘴唇微撅、眼神坚定认真、眉头微锁，二次元傲娇萌态 |
| `angry_glare` | 蹙眉瞪 | angry | 过渡 600ms / 停留 1000ms / 归位 2000ms | 头部微侧、视线聚焦、严肃中带有可爱的认真感 |
| `annoyed` | 略烦躁 | neutral | 过渡 600ms / 停留 1000ms / 保持 | 视线微斜、眼帘微敛，展现轻微厌倦的白眼感 |
| `weary` | 略困倦 | neutral | 过渡 600ms / 停留 1000ms / 保持 | 眼帘半垂、头部微沉，展现困乏放松的自然神态 |
| `embarrassed` | 窘迫尴尬 | embarrassed | 过渡 600ms / 停留 1000ms / 归位 2000ms | 面颊泛红、眼神游离、嘴巴微张，不知所措的生动反应 |
| `shy` | 害羞低头 | shy | 过渡 600ms / 停留 1000ms / 归位 2000ms | 低眉颔首、视线向下微收、双颊绯红，娇羞含蓄 |
| `shy_peek` | 害羞偷瞄 | shy | 过渡 600ms / 停留 1000ms / 归位 2000ms | 侧过头去、眼珠向回轻瞄，充满互动感 |

---

## 重点测试的 3 个模型表现

实机快照已保存在 `D:\Frankenstein\review_snaps\` 目录下，可随时直接点开查看：

1. **日和 (`hiyori_pro`)**：
   - 原生包含 10 个官方动作组与 `ParamCheek`。
   - 调优后动作过渡极为流畅自然，低头害羞与委屈瞥目效果格外生动。
2. **标准初音 (`miku`)**：
   - 自动识别初音专属的脸红控件参数 `Param130`。
   - 歪头微笑动作协同身体轻微倾斜，解决了双马尾初音大幅度偏头时的割裂感。
3. **RetrynowMiku (`VTS Model File / RetrynowMiku`)**：
   - 自动适配其没有角度参数的 `Form` 眉毛体系与 `Blush` 脸红。
   - 严格过滤非面部表情控件，彻底杜绝了以往可能误掏出斧头、撬棍等近战道具的异常情况。

---

## 快速自测与调试

如需在本地通过命令行测试或快速抓图，可使用 `tools/deskpet_ctrl.py`：

```bash
# 查询当前加载的模型
py -3 tools/deskpet_ctrl.py cur

# 切换模型（支持模糊匹配）
py -3 tools/deskpet_ctrl.py switch hiyori
py -3 tools/deskpet_ctrl.py switch miku
py -3 tools/deskpet_ctrl.py switch RetrynowMiku

# 恢复当前模型为最新代码默认预设
py -3 tools/deskpet_ctrl.py reset

# 触发指定状态预设
py -3 tools/deskpet_ctrl.py preset happy
py -3 tools/deskpet_ctrl.py preset shy
py -3 tools/deskpet_ctrl.py preset angry

# 抓取当前桌宠窗口无损透明快照
py -3 tools/deskpet_ctrl.py snap D:/Frankenstein/my_snap.png
```

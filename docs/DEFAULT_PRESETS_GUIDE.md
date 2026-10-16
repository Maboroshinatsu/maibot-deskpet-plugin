# Live2D 通用状态预设使用与调优说明

## 概览
本次更新对桌宠内置的 12 个默认状态预设进行了系统性重构与视觉实机调优。解决了过去通用模型上常见的“动作过于剧烈、歪头折颈、眼球外翻出眶、神态生硬以及误掏斧头等道具”的问题。

所有预设已在本地运行环境 `D:\Frankenstein\exetest\MaiBot Deskpet` 中实机部署完成，开箱即用。

---

## 12 个通用状态预设列表

| 预设标识 (ID) | 状态名称 | 情绪类型 | 结束动作 | 动作与神态特征 |
| :--- | :--- | :--- | :--- | :--- |
| `neutral` | 平常 | neutral | 保持 | 舒展自然的基础待机状态 |
| `happy` | 开心 | happy | 归位 | 眼睛微微弯起、嘴巴自然微笑、面颊浮现淡淡红晕 |
| `happy_tilt` | 开心歪头笑 | happy | 归位 | 头部自然微侧（配合身体同向倾斜，绝无折颈感），眉开眼笑 |
| `sad` | 委屈 | sad | 归位 | 嘴角自然向下微垂，双眉微蹙，眼神微含委屈 |
| `sad_glance` | 委屈撇目 | sad | 归位 | 略微侧视、抿唇低语，神态惹人怜爱 |
| `angry` | 气呼呼 | angry | 归位 | 嘴唇微撅、眼神坚定认真、眉头微锁，二次元傲娇萌态 |
| `angry_glare` | 蹙眉瞪 | angry | 归位 | 头部微侧、视线聚焦、严肃中带有可爱的认真感 |
| `annoyed` | 略烦躁 | neutral | 保持 | 视线微斜、眼帘微敛半闭，展现轻微厌倦的白眼感 |
| `weary` | 略困倦 | neutral | 保持 | 眼帘半垂、头部微沉，展现困乏放松的自然神态 |
| `embarrassed` | 窘迫尴尬 | embarrassed | 归位 | 面颊泛红、眼神游离、嘴巴微张，不知所措的生动反应 |
| `shy` | 害羞低头 | shy | 归位 | 低眉颔首、视线向下微收、双颊绯红，娇羞含蓄 |
| `shy_peek` | 害羞偷瞄 | shy | 归位 | 侧过头去、眼珠向回轻瞄，充满互动感 |

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

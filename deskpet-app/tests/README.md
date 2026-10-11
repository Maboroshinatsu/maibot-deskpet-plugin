# 首批可靠性回归测试

本目录测试 ServiceManager 的 DP-001、DP-002、DP-004 修复，以及 PTT 控制器和录音取消链路。没有新增测试依赖，使用 Node 内置 test runner 和项目已有 TypeScript 编译器。

## 运行

在项目应用目录运行：

```powershell
Set-Location 'D:\Frankenstein\maibot-deskpet-plugin\deskpet-app'
npm test
npm run typecheck
npm run test:watchdog
```

最后一条需要当前 PATH 的 Python 可用，且运行于 Windows。也可用已安装的 Python 解释器绝对路径执行 `-B watchdog_selftest.py`；不要求安装语音模型或启动 MaiBot。

## 安全边界

- JS 测试将当前 services.ts 编译后放入隔离 VM，Electron、文件系统写入、子进程与定时器均使用测试替身。
- 不启动 Electron、STT、TTS、GPT-SoVITS 或热键桥；不会执行真实 taskkill。
- 一个集成用例创建临时 loopback TCP 监听器，验证端口占用时不 spawn/kill；测试结束关闭监听器。
- Python 测试仅创建自己的短生命周期子进程；不使用固定“应该不存在”的 PID，也不对模拟 WinAPI 句柄执行真实 CloseHandle。
- 启动、停止、重启、历史配置、旧回调和退出逻辑通过测试，不代表 Windows 原生进程树、托盘和全局键盘已经端到端验收。

## 覆盖重点

- 所有有端口的服务遇到占用均保留外部进程；超时/权限错误不能当作空闲。
- 多次 start 共享单飞任务；stop/quit 可取消尚未完成的启动。
- restart 必须等原实例退出；重复请求和超时不能创建重复实例。
- 旧进程的 exit/error/stdout/stderr/健康探测/停止回调不能污染新实例。
- 停止失败保留进程所有权并允许重试，不能按“已停止”启动第二份。
- hotkey 的旧 showTerminal=true 和直接配置更新均归一为 false，分段 stdout 仍解析 down/up。
- watchdog 检查存活/退出/WinAPI 错误和句柄释放，哨兵确认父进程存活时不会提前退出。

新增测试时继续保持无业务进程副作用；真实设备、真实语音或安装包测试须单独记录范围和结果。


PTT/录音测试使用真实控制器源码与假的麦克风、录音器、STT，覆盖停止不提交半截录音、授权晚到释放、取消后不发送旧文本以及不接管手动/VAD录音。

组合回归还覆盖：PTT 录音被手动入口结束并替换后，旧 PTT 不能停止/取消新手动录音；PTT/VAD 共用授权时，取消 PTT 不关闭 VAD 所需的流；所有消费者取消或 VAD 启动失败时不泄漏麦克风。


## 显式实际运行测试（不包含在 npm test 中）

- `npm run test:runtime-services`：Windows真实子进程与loopback端口，限定为当次运行创建的Node夹具，带所有权校验与finally清理。不启动真实语音/热键服务。
- `npm run test:runtime-ui`：加载真实生产构建，创建临时用户目录，禁用后台服务自启、自动截图，并阻断外部网络与麦克风权限。需先运行build；窗口标题为“MaiBot Deskpet — Runtime QA”，用Alt+F4关闭。勿在此QA窗口手动启动实际语音服务。
- 两种测试均不制作NSIS安装包。UI启动器保留临时日志用于排错，不自动删除目录。
- root级runtime-ui.cjs是一个薄包装器，使Electron的app.getAppPath保持真实应用根目录；直接启动tests/runtime-ui.cjs会改变此路径，不作为常规验收方式。
- `imageset.test.cjs` 覆盖相对清单的file/HTTP/deskpet路径、中文空格、重定向和HTML回退；默认npm test包含此文件。


## 不涉及麦克风的验证入口

`npm run test:no-mic` 只运行解释器路径策略、候选/确认流程、WS 来源隔离以及图片 URL 测试，不运行录音、VAD、PTT 用例，也不启动真实桥。

插件卸载回归：`npm run test:plugin-lifecycle`（使用 SDK/网络测试替身与假协程，不请求 TTS 或音频设备）。

> 若 `python` 指向 Microsoft Store 别名桩（报 “Python was not found”），改用真实解释器绝对路径执行，例如 `& "<你的Python>\python.exe" -B ../tests/test_plugin_lifecycle.py`。`test:watchdog` 同理。

类型检查与构建同样不会触发麦克风。默认 `npm test` 仍保留上一批完整回归入口，包含模拟录音/PTT 用例；用户暂停这些验证期间不执行该命令。

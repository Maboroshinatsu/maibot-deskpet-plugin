"""看门狗 —— 桥进程的父进程存活检测。

桥由桌宠主进程 spawn 拉起。Electron 侧在 spawn 时把桌宠主进程的 PID 通过
环境变量 DESKPET_PARENT_PID 传给桥。看门狗后台线程每 3 秒检查一次这个
PID 是否存活，一旦消失就自杀退出。

为什么不用 Windows 的 ParentProcessId / stdin EOF：
- ParentProcessId 在父进程死后会被 Windows 重定向到控制台宿主等中间进程，
  盯它不可靠；
- stdin EOF 只在父进程「优雅退出」时触发，任务管理器强杀不关闭管道。

查 PID 存活用 OpenProcess + WaitForSingleObject，纯标准库，不依赖 psutil。
手动跑桥（start.bat / 直接 python）时没有 DESKPET_PARENT_PID，不启用。
"""
import ctypes
import os
import sys
import threading
import time

_ProcessHandle = ctypes.windll.kernel32.OpenProcess
_WaitForSingleObject = ctypes.windll.kernel32.WaitForSingleObject
_CloseHandle = ctypes.windll.kernel32.CloseHandle
_SYNCHRONIZE = 0x00100000
_WAIT_TIMEOUT = 0x102


def _is_alive(pid: int) -> bool:
    """pid 进程是否仍在运行。"""
    handle = _ProcessHandle(_SYNCHRONIZE, False, pid)
    if not handle:
        return False  # 打不开 = 进程已不存在
    try:
        return _WaitForSingleObject(handle, 0) == _WAIT_TIMEOUT
    finally:
        _CloseHandle(handle)


def start_watchdog(interval: float = 3.0) -> None:
    """桌宠主进程 PID 消失后自杀。仅在拿到 DESKPET_PARENT_PID 时启用。"""
    raw = os.environ.get("DESKPET_PARENT_PID", "").strip()
    if not raw or not raw.isdigit():
        # 手动跑桥（没有 Electron 传入的环境变量）→ 不启用
        return

    parent = int(raw)
    print(f"[watchdog] 守护桌宠主进程 {parent}（桌宠退出将自动退出）", flush=True)

    def _watch() -> None:
        while True:
            time.sleep(interval)
            if not _is_alive(parent):
                print("[watchdog] 桌宠已退出，桥进程自杀", flush=True)
                os._exit(0)

    threading.Thread(target=_watch, daemon=True).start()

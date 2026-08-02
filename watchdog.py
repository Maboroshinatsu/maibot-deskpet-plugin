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
from ctypes import wintypes
import os
import threading
import time

# Windows HANDLE 是指针宽度；显式声明原型，避免 64 位 Python 下句柄被
# ctypes 默认的 c_int 截断。use_last_error 让 ctypes 保留 WinAPI 错误码。
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
_ProcessHandle = _kernel32.OpenProcess
_ProcessHandle.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
_ProcessHandle.restype = wintypes.HANDLE
_WaitForSingleObject = _kernel32.WaitForSingleObject
_WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
_WaitForSingleObject.restype = wintypes.DWORD
_CloseHandle = _kernel32.CloseHandle
_CloseHandle.argtypes = (wintypes.HANDLE,)
_CloseHandle.restype = wintypes.BOOL

_SYNCHRONIZE = 0x00100000
_WAIT_OBJECT_0 = 0x00000000
_WAIT_TIMEOUT = 0x00000102
_WAIT_FAILED = 0xFFFFFFFF


def _is_alive(pid: int) -> bool:
    """pid 进程是否仍在运行；WaitForSingleObject 查询失败会抛出异常。

    OpenProcess 打不开不算异常：进程已经退出（或被系统回收）时拿到的就是
    NULL 句柄——这正是看门狗要检测的「父进程消亡」正常路径，应返回 False
    让桥走 os._exit(0) 干净退出，而不是抛异常走 os._exit(1) 被服务面板
    标成「进程异常退出」的红错。
    """
    handle = _ProcessHandle(_SYNCHRONIZE, False, pid)
    if not handle:
        return False  # 进程已不存在 = 父进程消亡的正常信号
    try:
        result = _WaitForSingleObject(handle, 0)
        if result == _WAIT_TIMEOUT:
            return True
        if result == _WAIT_OBJECT_0:
            return False
        if result == _WAIT_FAILED:
            error = ctypes.get_last_error()
            raise OSError(error, f"WaitForSingleObject({pid}) failed")
        raise RuntimeError(f"WaitForSingleObject({pid}) returned 0x{result:08x}")
    finally:
        _CloseHandle(handle)


def start_watchdog(interval: float = 3.0) -> None:
    """桌宠主进程 PID 消失后自杀。仅在拿到 DESKPET_PARENT_PID 时启用。"""
    raw = os.environ.get("DESKPET_PARENT_PID", "").strip()
    if not raw or not raw.isdigit():
        # 手动跑桥（没有 Electron 传入的环境变量）→ 不启用
        return

    parent = int(raw)
    print(
        f"[watchdog] 守护桌宠主进程 {parent}（桌宠退出将自动退出，模块={__file__}）",
        flush=True,
    )

    # 闭包里 _is_alive 绑定的是模块全局查找；显式捕获为局部变量，
    # 保证即使调用方替换了模块属性，线程仍使用当前实现（也便于单元测试注入）。
    is_alive = _is_alive

    def _watch() -> None:
        try:
            while True:
                time.sleep(interval)
                if not is_alive(parent):
                    print("[watchdog] 桌宠已退出，桥进程自杀", flush=True)
                    os._exit(0)
        except BaseException as exc:
            # 看门狗不能静默死亡，否则 HTTP bridge 会变成孤儿进程并继续占端口。
            print(f"[watchdog] 父进程状态检查失败，桥进程退出: {exc!r}", flush=True)
            os._exit(1)

    threading.Thread(target=_watch, daemon=True, name="deskpet-watchdog").start()

"""Windows watchdog contract tests; only mocks and test-owned child processes are used."""
from pathlib import Path
import os
import subprocess
import sys

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PLUGIN_ROOT))
import watchdog as wd  # noqa: E402

ok = True
checks = 0
CHILD_OPTIONS = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


def check(name: str, cond: bool) -> None:
    global ok, checks
    checks += 1
    print(("PASS" if cond else "FAIL") + " " + name, flush=True)
    if not cond:
        ok = False


check("alive(self) -> True", wd._is_alive(os.getpid()) is True)

# A controlled child waits for us instead of racing a short fixed sleep.
sub = subprocess.Popen(
    [sys.executable, "-B", "-c", "import sys; sys.stdin.readline()"],
    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    text=True, **CHILD_OPTIONS,
)
try:
    check("alive(owned child) -> True", wd._is_alive(sub.pid) is True)
    sub.communicate(input="finish\n", timeout=5)
    check("exited(owned child) -> False", wd._is_alive(sub.pid) is False)
finally:
    if sub.poll() is None:
        sub.kill()
        sub.wait(timeout=5)
    if sub.stdin:
        sub.stdin.close()

original = (wd._ProcessHandle, wd._WaitForSingleObject, wd._CloseHandle)

# No arbitrary 'invalid PID' assumption and no real API call on mock handles.
calls = []
wd._ProcessHandle = lambda *args: 0
wd._WaitForSingleObject = lambda *args: calls.append("wait")
wd._CloseHandle = lambda handle: calls.append("close")
try:
    check("OpenProcess NULL -> False", wd._is_alive(1) is False)
    check("NULL handle is neither waited nor closed", calls == [])
finally:
    wd._ProcessHandle, wd._WaitForSingleObject, wd._CloseHandle = original

for result, expected, name in (
    (wd._WAIT_TIMEOUT, True, "WAIT_TIMEOUT"),
    (wd._WAIT_OBJECT_0, False, "WAIT_OBJECT_0"),
    (wd._WAIT_FAILED, None, "WAIT_FAILED"),
):
    calls = []
    wd._ProcessHandle = lambda *args: 12345
    wd._WaitForSingleObject = lambda handle, ms: result
    wd._CloseHandle = lambda handle: calls.append(handle) or True
    try:
        if expected is None:
            try:
                wd._is_alive(1)
                check(f"{name} raises OSError", False)
            except OSError:
                check(f"{name} raises OSError", True)
        else:
            check(f"{name} -> {expected}", wd._is_alive(1) is expected)
        check(f"handle closed after {name}", calls == [12345])
    finally:
        wd._ProcessHandle, wd._WaitForSingleObject, wd._CloseHandle = original


def run_child(mode: str):
    code = (
        "import sys,time\n"
        "sys.path.insert(0, sys.argv[1])\n"
        "import watchdog as wd\n"
    )
    if mode == "parent_dead":
        code += "wd._is_alive=lambda pid: False\n"
    elif mode == "thread_exc":
        code += "wd._is_alive=lambda pid: (_ for _ in ()).throw(RuntimeError('test failure'))\n"
    elif mode == "parent_alive":
        code += "wd._is_alive=lambda pid: True\n"
    else:
        raise ValueError(mode)
    code += "wd.start_watchdog(0.01)\ntime.sleep(0.5)\nprint('SURVIVED', flush=True)\n"
    result = subprocess.run(
        [sys.executable, "-B", "-c", code, str(PLUGIN_ROOT)],
        env={**os.environ, "DESKPET_PARENT_PID": "12345", "PYTHONIOENCODING": "utf-8"},
        capture_output=True, text=True, encoding="utf-8", timeout=15, **CHILD_OPTIONS,
    )
    return result.returncode, "SURVIVED" in result.stdout.splitlines()


check("parent dead -> exit(0) before sentinel", run_child("parent_dead") == (0, False))
check("thread failure -> exit(1) before sentinel", run_child("thread_exc") == (1, False))
check("parent alive -> reaches sentinel", run_child("parent_alive") == (0, True))
print(f"{checks} checks; {'PASS' if ok else 'FAIL'}", flush=True)
sys.exit(0 if ok else 1)

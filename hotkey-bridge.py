"""PTT hotkey bridge — 全局热键监听，stdout 输出 PTT_DOWN / PTT_UP 事件行。

由桌宠 ServiceManager 拉起（复用 MaiBot 的 Python 环境），键位经环境变量配置：
  DESKPET_PTT_KEY   键位（默认 f9）。支持：
                    f1..f24、scroll_lock、pause、caps_lock、print_screen、insert、
                    单字符（如 ` \\ ]）、鼠标键：mouse4/mouse5（侧键，同 mouse_x1/mouse_x2）、
                    mouse3/mouse_middle（滚轮按下）

stdout 协议：事件独占一行（PTT_DOWN / PTT_UP），其余行是给人看的日志。
主进程按行解析，事件行转发渲染层，日志行进服务日志面板。
"""
import os
import sys

KEY_SPEC = os.environ.get("DESKPET_PTT_KEY", "f9").strip().lower()

# 鼠标键别名：游戏/驱动里惯用的 mouse3/4/5 与 Windows/pynput 的 x1/x2 两套写法都收
_MOUSE_BUTTONS = {
    "mouse_x1": "x1", "mouse4": "x1",
    "mouse_x2": "x2", "mouse5": "x2",
    "mouse_middle": "middle", "mouse3": "middle",
}


def _parse_key(spec: str):
    """返回 (kind, target)：kind 为 keyboard / mouse。"""
    try:
        from pynput.keyboard import Key, KeyCode
        from pynput.mouse import Button
    except ImportError:
        raise RuntimeError(
            "缺少依赖 pynput。该依赖由 MaiBot 插件自动安装，请先启动 MaiBot 加载插件；"
            "或手动执行：pip install pynput"
        )

    if spec in _MOUSE_BUTTONS:
        return "mouse", getattr(Button, _MOUSE_BUTTONS[spec])
    if len(spec) == 1:
        return "keyboard", KeyCode.from_char(spec)
    key = getattr(Key, spec, None)
    if key is None:
        raise ValueError(
            f"unknown key: {spec!r}（支持 f1..f24、scroll_lock、pause、caps_lock、"
            f"print_screen、insert、单字符、{', '.join(_MOUSE_BUTTONS)}）"
        )
    return "keyboard", key


def main() -> None:
    try:
        kind, target = _parse_key(KEY_SPEC)
    except (ValueError, RuntimeError) as exc:
        print(f"[hotkey-bridge] ERROR: {exc}", flush=True)
        sys.exit(1)

    # 桌宠退出后自动跟着退出，避免孤儿进程残留
    try:
        import watchdog
        watchdog.start_watchdog()
    except ImportError:
        pass

    pressed = False

    def _down() -> None:
        nonlocal pressed
        if pressed:
            return  # 长按的键自动重复只报第一次
        pressed = True
        print("PTT_DOWN", flush=True)

    def _up() -> None:
        nonlocal pressed
        if not pressed:
            return
        pressed = False
        print("PTT_UP", flush=True)

    def on_press(key) -> None:
        if key == target:
            _down()

    def on_release(key) -> None:
        if key == target:
            _up()

    def on_click(_x, _y, button, is_pressed) -> None:
        if button != target:
            return
        _down() if is_pressed else _up()

    if kind == "keyboard":
        from pynput import keyboard
        listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    else:
        from pynput import mouse
        listener = mouse.Listener(on_click=on_click)

    print(f"[hotkey-bridge] listening key={KEY_SPEC} kind={kind}", flush=True)
    with listener:
        listener.join()


if __name__ == "__main__":
    main()

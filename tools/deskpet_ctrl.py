"""桌宠调试控制与视觉走查命令行工具。

支持通过本地调试端口（127.0.0.1:8525）直接控制桌宠：
- 截图
- 切换模型（miku / hiyori / RetrynowMiku）
- 触发预设（happy / shy / angry / sad / annoyed / weary / embarrassed 等）
- 重置预设到代码默认
- 查询当前状态
"""

import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error

BASE_URL = "http://127.0.0.1:8525"

def exec_js(code: str) -> dict:
    url = f"{BASE_URL}/exec?code=" + urllib.parse.quote(code)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

def snap(save_path: str = "D:/Frankenstein/deskpet_snapshot.png") -> bool:
    url = f"{BASE_URL}/screenshot?save=" + urllib.parse.quote(save_path)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read()
            print(f"[Snap] Saved {len(data)} bytes to {save_path}")
            return True
    except Exception as e:
        print(f"[Snap] Failed: {e}")
        return False

def get_current_model() -> str:
    res = exec_js("window.__deskpetStore ? window.__deskpetStore.modelUrl : null")
    return res.get("result", "")

def get_models() -> list:
    res = exec_js("""
        (async () => {
            const list = await window.electronAPI.listModels();
            return list;
        })()
    """)
    return res.get("result", [])

def switch_model(target_name: str) -> bool:
    target_lower = target_name.lower()
    res = exec_js(f"""
        (async () => {{
            const list = await window.electronAPI.listModels();
            const hit = list.find(m => m.name.toLowerCase().includes('{target_lower}') || m.url.toLowerCase().includes('{target_lower}'));
            if (!hit) return {{ error: 'Model not found: {target_name}', available: list.map(m => m.name) }};
            await window.__deskpetStore.requestModelSwitch(hit.url);
            return {{ success: true, switchedTo: hit.name, url: hit.url }};
        }})()
    """)
    print(f"[Switch] {res}")
    return "error" not in res

def trigger_preset(preset_id: str) -> bool:
    res = exec_js(f"""
        (() => {{
            if (!window.__deskpetStore) return {{ error: 'No store' }};
            const p = window.__deskpetStore.statePresets.find(p => p.id.toLowerCase() === '{preset_id.lower()}');
            if (!p) return {{ error: 'Preset not found: {preset_id}', available: window.__deskpetStore.statePresets.map(x => x.id) }};
            window.__deskpetStore.triggerPreset(p);
            return {{ success: true, triggered: p.label, finishMode: p.finishMode }};
        }})()
    """)
    print(f"[Preset] {res}")
    return "error" not in res

def reset_presets() -> bool:
    res = exec_js("""
        (() => {
            if (!window.__deskpetStore) return { error: 'No store' };
            const seeded = window.__deskpetStore.restoreDefaultPresets();
            return { success: true, count: seeded.length };
        })()
    """)
    print(f"[Reset] {res}")
    return "error" not in res

def get_presets() -> list:
    res = exec_js("""
        (() => {
            if (!window.__deskpetStore) return [];
            return window.__deskpetStore.statePresets.map(p => ({
                id: p.id,
                label: p.label,
                group: p.group,
                emotion: p.emotion,
                finishMode: p.finishMode,
                stepsCount: (p.steps || []).length,
                params: Object.keys(p.parameters || {})
            }));
        })()
    """)
    return res.get("result", [])

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: deskpet_ctrl.py <models|cur|snap|switch <name>|preset <id>|reset|presets>")
        sys.exit(1)
    cmd = sys.argv[1].lower()
    if cmd == "models":
        print(json.dumps(get_models(), ensure_ascii=False, indent=2))
    elif cmd == "cur":
        print("Current model:", get_current_model())
    elif cmd == "snap":
        target = sys.argv[2] if len(sys.argv) > 2 else "D:/Frankenstein/deskpet_snapshot.png"
        snap(target)
    elif cmd == "switch":
        switch_model(sys.argv[2])
    elif cmd == "preset":
        trigger_preset(sys.argv[2])
    elif cmd == "reset":
        reset_presets()
    elif cmd == "presets":
        print(json.dumps(get_presets(), ensure_ascii=False, indent=2))
    else:
        print("Unknown command:", cmd)

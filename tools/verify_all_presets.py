"""自动走查 3 个目标模型的全部 12 个默认状态预设并截图。
"""

import os
import sys
import time
import json
import urllib.request
import urllib.parse

BASE_URL = "http://127.0.0.1:8525"
OUT_DIR = "D:/Frankenstein/review_snaps"

def exec_js(code: str) -> dict:
    url = f"{BASE_URL}/exec?code=" + urllib.parse.quote(code)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

def snap(save_path: str) -> bool:
    url = f"{BASE_URL}/screenshot?save=" + urllib.parse.quote(save_path)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
            return len(data) > 0
    except Exception as e:
        print(f"  [Snap Failed] {e}")
        return False

def wait_for_model_loaded(timeout=10.0):
    start = time.time()
    while time.time() - start < timeout:
        res = exec_js("window.__deskpetStore ? window.__deskpetStore.modelLoaded : false")
        if res.get("result") is True:
            return True
        time.sleep(0.3)
    return False

def switch_and_wait(pattern: str):
    code = f"""
    (async () => {{
        const list = await window.electronAPI.listModels();
        const hit = list.find(m => m.name.toLowerCase().includes('{pattern.lower()}') || m.url.toLowerCase().includes('{pattern.lower()}'));
        if (!hit) return {{ error: 'not found: {pattern}' }};
        await window.__deskpetStore.requestModelSwitch(hit.url);
        return {{ success: true, name: hit.name, url: hit.url }};
    }})()
    """
    res = exec_js(code)
    print(f"[Switch] -> {pattern}: {res}")
    time.sleep(1.5)
    wait_for_model_loaded()
    # 切换后一键恢复最新代码预设
    reset_res = exec_js("window.__deskpetStore ? window.__deskpetStore.restoreDefaultPresets() : []")
    print(f"[RestoreDefault] count = {len(reset_res.get('result', []))}")
    time.sleep(0.5)

def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    models = [
        ("standard_miku", "models/miku/miku.model3.json"),
    ]

    preset_ids = [
        "neutral",
        "happy",
        "happy_tilt",
        "sad",
        "sad_glance",
        "angry",
        "angry_glare",
        "annoyed",
        "weary",
        "embarrassed",
        "shy",
        "shy_peek",
    ]

    results = []

    for model_key, match_pattern in models:
        print(f"\n==========================================")
        print(f"Testing Model: {model_key} (pattern: {match_pattern})")
        print(f"==========================================")
        switch_and_wait(match_pattern)

        for pid in preset_ids:
            # 触发预设
            trigger_code = f"""
            (() => {{
                if (!window.__deskpetStore) return {{ error: 'No store' }};
                const p = window.__deskpetStore.statePresets.find(x => x.id === '{pid}');
                if (!p) return {{ error: 'Preset not found: {pid}' }};
                window.__deskpetStore.triggerPreset(p);
                return {{ success: true, id: p.id, label: p.label }};
            }})()
            """
            t_res = exec_js(trigger_code)
            
            # 等待进入峰值展示姿态（约 450~550ms）
            time.sleep(0.55)

            out_file = os.path.join(OUT_DIR, f"{model_key}_{pid}.png").replace("\\", "/")
            ok = snap(out_file)
            print(f"  Preset [{pid:12s}] -> {out_file} (snap ok: {ok})")
            results.append((model_key, pid, out_file, ok))

            # 稍微缓冲一下，让过渡回落或自然留白
            time.sleep(0.6)

    print("\n\nAll test snapshots complete. Total:", len(results))

if __name__ == "__main__":
    run()

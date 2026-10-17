import os
import json

base_dir = r"C:\Users\Administrator\AppData\Roaming\maibot-deskpet\models"
for root, dirs, files in os.walk(base_dir):
    if "deskpet-presets.json" in files:
        fpath = os.path.join(root, "deskpet-presets.json")
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            presets = data.get("presets", [])
            ids = [p.get("id") for p in presets]
            custom_named = [p.get("label") for p in presets if p.get("id") not in [
                "neutral", "happy", "happy_tilt", "sad", "sad_glance",
                "angry", "angry_glare", "annoyed", "weary", "embarrassed", "shy", "shy_peek"
            ]]
            happy = next((p for p in presets if p.get("id") == "happy"), None)
            h_dur = None
            h_eye = None
            if happy and happy.get("steps"):
                h_dur = happy["steps"][0].get("durationMs")
                h_eye = happy["steps"][0].get("parameters", {}).get("ParamEyeLOpen")
            rel = os.path.relpath(fpath, base_dir)
            v = data.get("version")
            print(f"{rel}: ver={v}, presets={len(presets)}, happy_dur={h_dur}, happy_eye={h_eye}, custom={custom_named}")
        except Exception as e:
            print(f"{fpath}: err {e}")

"""SenseVoice STT bridge — 仅语音识别。"""
import os as _os
import shutil
import tempfile
import wave

import numpy as np
from aiohttp import web

PORT = 18530

MODEL_DIR = _os.path.join(
    _os.path.dirname(_os.path.abspath(__file__)), "deskpet-app", "sensevoice"
)
MODEL_PATH = _os.path.join(MODEL_DIR, "model.onnx")
TOKENS_PATH = _os.path.join(MODEL_DIR, "tokens.txt")
_recognizer = None


def _get_stt():
    global _recognizer
    if _recognizer is None:
        import sherpa_onnx
        _recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=MODEL_PATH, tokens=TOKENS_PATH, language="zh"
        )
        print(f"[stt-bridge] model loaded")
    return _recognizer


async def handle_stt(request: web.Request) -> web.Response:
    data = await request.read()
    if not data:
        return web.json_response({"error": "empty body"}, status=400)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        rec = _get_stt()
        stream = rec.create_stream()
        with wave.open(tmp_path, "rb") as wf:
            samples = wf.readframes(wf.getnframes())
            audio = np.frombuffer(samples, dtype=np.int16).astype(np.float32) / 32768.0
            stream.accept_waveform(wf.getframerate(), audio)
        rec.decode_stream(stream)
        return web.json_response({"text": stream.result.text})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)
    finally:
        try:
            _os.unlink(tmp_path)
        except OSError:
            pass


async def handle_options(_request: web.Request) -> web.Response:
    return web.Response(
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    )


def main() -> None:
    import sys
    if not _os.path.isfile(MODEL_PATH):
        print(f"[stt-bridge] ERROR: Model file not found: {MODEL_PATH}")
        print("[stt-bridge] Download it from: https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        sys.exit(1)
    if not _os.path.isfile(TOKENS_PATH):
        print(f"[stt-bridge] ERROR: Tokens file not found: {TOKENS_PATH}")
        print("[stt-bridge] Download it from: https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        sys.exit(1)

    app = web.Application()
    app.router.add_post("/stt", handle_stt)
    app.router.add_route("OPTIONS", "/stt", handle_options)
    print(f"[stt-bridge] listening on http://127.0.0.1:{PORT}/stt")
    web.run_app(app, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()

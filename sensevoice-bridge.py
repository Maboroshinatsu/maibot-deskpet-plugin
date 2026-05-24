"""SenseVoice STT HTTP bridge — 接收音频文件，返回识别文本。"""
import io
import tempfile
import wave
import numpy as np

from aiohttp import web

PORT = 18531
import os as _os
MODEL_DIR = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "deskpet-app", "sensevoice")
MODEL_PATH = _os.path.join(MODEL_DIR, "model.onnx")
TOKENS_PATH = _os.path.join(MODEL_DIR, "tokens.txt")

# lazy init
_recognizer = None


def get_recognizer():
    global _recognizer
    if _recognizer is None:
        import sherpa_onnx

        _recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=MODEL_PATH,
            tokens=TOKENS_PATH,
        )
        print(f"[sensevoice-bridge] Model loaded from {MODEL_DIR}")
    return _recognizer


async def handle_stt(request: web.Request) -> web.Response:
    try:
        data = await request.read()
    except Exception:
        return web.json_response({"error": "failed to read body"}, status=400)

    if not data:
        return web.json_response({"error": "empty body"}, status=400)

    # Save incoming audio to a temp WAV file
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        rec = get_recognizer()
        stream = rec.create_stream()
        with wave.open(tmp_path, 'rb') as wf:
            assert wf.getnchannels() == 1, 'mono required'
            assert wf.getsampwidth() == 2, '16-bit required'
            samples = wf.readframes(wf.getnframes())
            import numpy as np
            audio = np.frombuffer(samples, dtype=np.int16).astype(np.float32) / 32768.0
            stream.accept_waveform(wf.getframerate(), audio)
        rec.decode_stream(stream)
        text = stream.result.text
        return web.json_response({"text": text})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)
    finally:
        import os

        try:
            os.unlink(tmp_path)
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
    app = web.Application()
    app.router.add_post("/stt", handle_stt)
    app.router.add_route("OPTIONS", "/stt", handle_options)
    print(f"[sensevoice-bridge] listening on http://127.0.0.1:{PORT}/stt")
    web.run_app(app, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()

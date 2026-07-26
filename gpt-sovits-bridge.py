"""GPT-SoVITS bridge — 接收简单文本，转发到 GPT-SoVITS API。"""
import asyncio
import io
import json
import os
import urllib.request

from aiohttp import web

PORT = 9881
SOVITS_URL = "http://127.0.0.1:9880/tts"
REF_AUDIO_PATH = r"D:\GPT-SoVITS-v2pro-20250604\终末地全角色GSV模型\参考音（视）频\昼雪\昼雪\昼雪-cut-.wav_0000000000_0000153600.wav"
PROMPT_TEXT = "这套装备充满了工匠的巧思呢，是新的外情任务吗？"
PROMPT_LANG = "zh"
TEXT_LANG = "zh"
SPEED = 0.9        # 稍慢更自然
FRAGMENT_INTERVAL = 0.5  # 句间停顿
TEMPERATURE = 0.9  # 轻微随机感
TOP_K = 10         # 采样多样性
TOP_P = 0.9


async def handle_tts(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "text is empty"}, status=400)

    ref_audio = body.get("ref_audio_path", REF_AUDIO_PATH)
    if ref_audio != REF_AUDIO_PATH and not (isinstance(ref_audio, str) and os.path.isfile(ref_audio)):
        return web.json_response({"error": "ref_audio_path not found"}, status=400)

    params = {
        "text": text,
        "text_lang": body.get("text_lang", TEXT_LANG),
        "ref_audio_path": ref_audio,
        "prompt_text": body.get("prompt_text", PROMPT_TEXT),
        "prompt_lang": body.get("prompt_lang", PROMPT_LANG),
        "speed_factor": body.get("speed_factor", SPEED),
        "fragment_interval": body.get("fragment_interval", FRAGMENT_INTERVAL),
        "temperature": body.get("temperature", TEMPERATURE),
        "top_k": body.get("top_k", TOP_K),
        "top_p": body.get("top_p", TOP_P),
        "media_type": "wav",
    }

    def _synthesize() -> bytes:
        req_data = json.dumps(params).encode("utf-8")
        req = urllib.request.Request(
            SOVITS_URL, data=req_data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()

    try:
        # 合成最长两分钟，同步跑会把整个事件循环冻住、后续请求全部排队超时
        audio = await asyncio.to_thread(_synthesize)
        return web.Response(body=audio, content_type="audio/wav")
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


async def handle_options(_request: web.Request) -> web.Response:
    return web.Response(headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    })


def main() -> None:
    app = web.Application()
    app.router.add_post("/tts", handle_tts)
    app.router.add_route("OPTIONS", "/tts", handle_options)
    print(f"[gpt-sovits-bridge] listening on http://127.0.0.1:{PORT}/tts")
    print(f"[gpt-sovits-bridge] forwarding to {SOVITS_URL}")
    print("[gpt-sovits-bridge] TODO: edit REF_AUDIO_PATH and PROMPT_TEXT in the script")
    web.run_app(app, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()

"""Cloud TTS bridge — 接入第三方线上 TTS 后端（MiMo / Qwen CosyVoice / GSV2P）。

契约与 gpt-sovits-bridge 完全一致：POST /tts {"text": "..."} → 返回 wav 二进制。
桌宠插件把 TTS 桥地址指向本桥即可切换云端合成，前端/插件零改动。

后端经环境变量选择（桌宠设置面板「后台服务 → 服务路径配置」里填好后注入）：
  DESKPET_TTS_BACKEND      = mimo | cosyvoice | gsv2p（必填）
  DESKPET_MIMO_API_KEY     小米 MiMo API Key（必填）
  DESKPET_MIMO_VOICE       MiMo 音色（默认 mimo_default；风格可用 <style>开心</style> 前缀文本）
  DESKPET_COSYVOICE_API_KEY  阿里云百炼 DashScope API Key（必填）
  DESKPET_COSYVOICE_MODEL    默认 qwen-audio-3.0-tts-flash
  DESKPET_COSYVOICE_VOICE    音色（默认 cherry；示例 longanhuan_v3.6）
  DESKPET_COSYVOICE_ENDPOINT 默认经典 dashscope.aliyuncs.com 端点，可填 WorkspaceId 域名
  DESKPET_GSV2P_TOKEN      GSV2P Token（必填）
  DESKPET_GSV2P_VOICE      GSV2P 音色（默认 原神-中文-派蒙_ZH）
"""
import asyncio
import base64
import json
import os
import urllib.request

try:
    from aiohttp import web
except ImportError:
    import sys
    print(
        "[cloud-tts-bridge] ERROR: 缺少依赖 aiohttp。"
        "该依赖由 MaiBot 插件自动安装，请先启动 MaiBot 加载插件；"
        "或手动执行：pip install aiohttp",
        file=sys.stderr,
    )
    raise

PORT = 9882
TIMEOUT = 60

MIMO_URL = "https://api.xiaomimimo.com/v1/chat/completions"
MIMO_MODEL = "mimo-v2.5-tts"
MIMO_DEFAULT_VOICE = "mimo_default"

COSYVOICE_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/SpeechSynthesizer"
COSYVOICE_MODEL = "qwen-audio-3.0-tts-flash"
COSYVOICE_DEFAULT_VOICE = "cherry"

GSV2P_URL = "https://gsv2p.acgnai.top/v1/audio/speech"
GSV2P_MODEL = "tts-v4"
GSV2P_DEFAULT_VOICE = "原神-中文-派蒙_ZH"


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def _backend_config() -> tuple[str, dict]:
    """返回 (backend, config)；config 含缺失的必填项错误信息。"""
    backend = _env("DESKPET_TTS_BACKEND").lower()
    if backend not in ("mimo", "cosyvoice", "gsv2p"):
        return "unknown", {"error": "未配置 DESKPET_TTS_BACKEND（mimo / cosyvoice / gsv2p）"}

    if backend == "mimo":
        key = _env("DESKPET_MIMO_API_KEY")
        if not key:
            return backend, {"error": "缺少 DESKPET_MIMO_API_KEY（小米 MiMo API Key）"}
        return backend, {
            "url": MIMO_URL,
            "api_key": key,
            "voice": _env("DESKPET_MIMO_VOICE", MIMO_DEFAULT_VOICE),
        }

    if backend == "cosyvoice":
        key = _env("DESKPET_COSYVOICE_API_KEY")
        if not key:
            return backend, {"error": "缺少 DESKPET_COSYVOICE_API_KEY（阿里云百炼 API Key）"}
        return backend, {
            "url": _env("DESKPET_COSYVOICE_ENDPOINT", COSYVOICE_ENDPOINT),
            "api_key": key,
            "model": _env("DESKPET_COSYVOICE_MODEL", COSYVOICE_MODEL),
            "voice": _env("DESKPET_COSYVOICE_VOICE", COSYVOICE_DEFAULT_VOICE),
        }

    # gsv2p
    token = _env("DESKPET_GSV2P_TOKEN")
    if not token:
        return backend, {"error": "缺少 DESKPET_GSV2P_TOKEN（GSV2P Token）"}
    return backend, {
        "url": GSV2P_URL,
        "api_key": token,
        "voice": _env("DESKPET_GSV2P_VOICE", GSV2P_DEFAULT_VOICE),
    }


def _synthesize_mimo(text: str, cfg: dict) -> bytes:
    body = {
        "model": MIMO_MODEL,
        "messages": [{"role": "assistant", "content": text}],
        "audio": {"format": "wav", "voice": cfg["voice"]},
    }
    req = urllib.request.Request(
        cfg["url"], data=json.dumps(body).encode("utf-8"),
        headers={"api-key": cfg["api_key"], "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    try:
        b64 = data["choices"][0]["message"]["audio"]["data"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"MiMo 响应格式异常: {exc} — {str(data)[:200]}")
    audio = base64.b64decode(b64)
    if not audio:
        raise RuntimeError("MiMo 返回空音频")
    return audio


def _synthesize_cosyvoice(text: str, cfg: dict) -> bytes:
    body = {
        "model": cfg["model"],
        "input": {
            "text": text,
            "voice": cfg["voice"],
            "format": "wav",
            "sample_rate": 24000,
        },
    }
    req = urllib.request.Request(
        cfg["url"], data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def _synthesize_gsv2p(text: str, cfg: dict) -> bytes:
    body = {
        "model": GSV2P_MODEL,
        "input": text,
        "voice": cfg["voice"],
        "response_format": "wav",
    }
    req = urllib.request.Request(
        cfg["url"], data=json.dumps(body).encode("utf-8"),
        headers={"api_token": cfg["api_key"], "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


async def handle_tts(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "text is empty"}, status=400)

    backend, cfg = _backend_config()
    if "error" in cfg:
        return web.json_response({"error": cfg["error"]}, status=400)

    synthesizers = {
        "mimo": _synthesize_mimo,
        "cosyvoice": _synthesize_cosyvoice,
        "gsv2p": _synthesize_gsv2p,
    }
    synthesizer = synthesizers[backend]

    def _run() -> bytes:
        return synthesizer(text, cfg)

    try:
        # 云合成可能数秒，同步跑会冻住事件循环
        audio = await asyncio.to_thread(_run)
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
    # 桌宠退出后自动跟着退出，避免孤儿进程占着端口
    try:
        import watchdog
        watchdog.start_watchdog()
    except ImportError as exc:
        print(f"[cloud-tts-bridge] WARNING: watchdog 不可用，桥进程不会随桌宠退出: {exc!r}", flush=True)
    except Exception as exc:
        print(f"[cloud-tts-bridge] ERROR: watchdog 启动失败: {exc!r}", flush=True)
        raise

    backend, cfg = _backend_config()
    app = web.Application()
    app.router.add_post("/tts", handle_tts)
    app.router.add_route("OPTIONS", "/tts", handle_options)
    print(f"[cloud-tts-bridge] listening on http://127.0.0.1:{PORT}/tts")
    if backend == "unknown":
        print(f"[cloud-tts-bridge] WARNING: {cfg.get('error')}")
    else:
        voice = cfg.get("voice", "默认")
        print(f"[cloud-tts-bridge] backend={backend}, voice={voice}")
        if "error" in cfg:
            print(f"[cloud-tts-bridge] WARNING: {cfg['error']}（/tts 将返回 400）")
        else:
            print(f"[cloud-tts-bridge] forwarding to {cfg['url']}")
    web.run_app(app, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()

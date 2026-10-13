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


SILICONFLOW_URL = "https://api.siliconflow.cn/v1/audio/speech"
SILICONFLOW_MODEL = "FunAudioLLM/CosyVoice2-0.5B"
SILICONFLOW_DEFAULT_VOICE = "FunAudioLLM/CosyVoice2-0.5B:claire"

FISHAUDIO_URL = "https://api.fish.audio/v1/tts"

OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_TTS_MODEL = "tts-1"
OPENAI_DEFAULT_VOICE = "nova"


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def _first_env(*keys: str, default: str = "") -> str:
    for k in keys:
        val = _env(k)
        if val:
            return val
    return default


def _backend_config() -> tuple[str, dict]:
    """返回 (backend, config)；config 含缺失的必填项错误信息。"""
    backend = _env("DESKPET_TTS_BACKEND").lower()
    valid_backends = ("siliconflow", "cosyvoice", "mimo", "fishaudio", "gsv2p", "openai")
    if backend not in valid_backends:
        return "unknown", {"error": f"未配置有效的 DESKPET_TTS_BACKEND（可选：{' / '.join(valid_backends)}）"}

    common_key = _env("DESKPET_TTS_API_KEY")
    common_voice = _env("DESKPET_TTS_VOICE")
    common_model = _env("DESKPET_TTS_MODEL")
    common_endpoint = _env("DESKPET_TTS_ENDPOINT")

    if backend == "siliconflow":
        key = common_key or _env("DESKPET_SILICONFLOW_API_KEY")
        if not key:
            return backend, {"error": "缺少硅基流动 API Key"}
        model = common_model or SILICONFLOW_MODEL
        voice = common_voice or SILICONFLOW_DEFAULT_VOICE
        if ":" not in voice and model.startswith("FunAudioLLM/CosyVoice2"):
            voice = f"{model}:{voice}"
        return backend, {
            "url": common_endpoint or SILICONFLOW_URL,
            "api_key": key,
            "model": model,
            "voice": voice,
        }

    if backend == "mimo":
        key = common_key or _env("DESKPET_MIMO_API_KEY")
        if not key:
            return backend, {"error": "缺少 DESKPET_MIMO_API_KEY（小米 MiMo API Key）"}
        return backend, {
            "url": common_endpoint or MIMO_URL,
            "api_key": key,
            "model": common_model or MIMO_MODEL,
            "voice": common_voice or _env("DESKPET_MIMO_VOICE", MIMO_DEFAULT_VOICE),
        }

    if backend == "cosyvoice":
        key = common_key or _env("DESKPET_COSYVOICE_API_KEY")
        if not key:
            return backend, {"error": "缺少 DESKPET_COSYVOICE_API_KEY（阿里云百炼 API Key）"}
        return backend, {
            "url": common_endpoint or _env("DESKPET_COSYVOICE_ENDPOINT", COSYVOICE_ENDPOINT),
            "api_key": key,
            "model": common_model or _env("DESKPET_COSYVOICE_MODEL", COSYVOICE_MODEL),
            "voice": common_voice or _env("DESKPET_COSYVOICE_VOICE", COSYVOICE_DEFAULT_VOICE),
        }

    if backend == "fishaudio":
        key = common_key or _env("DESKPET_FISHAUDIO_API_KEY")
        if not key:
            return backend, {"error": "缺少 Fish Audio API Key"}
        return backend, {
            "url": common_endpoint or FISHAUDIO_URL,
            "api_key": key,
            "voice": common_voice,
        }

    if backend == "openai":
        return backend, {
            "url": common_endpoint or OPENAI_TTS_URL,
            "api_key": common_key,
            "model": common_model or OPENAI_TTS_MODEL,
            "voice": common_voice or OPENAI_DEFAULT_VOICE,
        }

    # gsv2p
    token = common_key or _env("DESKPET_GSV2P_TOKEN")
    if not token:
        return backend, {"error": "缺少 DESKPET_GSV2P_TOKEN（GSV2P Token）"}
    return backend, {
        "url": common_endpoint or GSV2P_URL,
        "api_key": token,
        "model": common_model or GSV2P_MODEL,
        "voice": common_voice or _env("DESKPET_GSV2P_VOICE", GSV2P_DEFAULT_VOICE),
    }


def _synthesize_mimo(text: str, cfg: dict) -> bytes:
    body = {
        "model": cfg.get("model") or MIMO_MODEL,
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
        raw = resp.read()

    # 如果直接返回了 WAV 或其他二进制音频格式，直接返回
    if raw.startswith((b"RIFF", b"ID3", b"\xff\xfb", b"OggS")):
        return raw

    # 尝试解析 JSON 响应
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return raw

    # 检查 DashScope 错误响应
    if isinstance(data, dict):
        if "code" in data or ("output" not in data and "message" in data):
            code = data.get("code", "Error")
            msg = data.get("message", "Unknown error")
            raise RuntimeError(f"百炼/CosyVoice 错误: {code} — {msg}")

        # 尝试提取音频下载链接 output.audio.url 或 output.url
        audio_url = None
        output = data.get("output")
        if isinstance(output, dict):
            audio_obj = output.get("audio")
            if isinstance(audio_obj, dict):
                audio_url = audio_obj.get("url")
                if not audio_url and "data" in audio_obj:
                    return base64.b64decode(audio_obj["data"])
            elif isinstance(audio_obj, str) and audio_obj.startswith("http"):
                audio_url = audio_obj
            if not audio_url and "url" in output:
                audio_url = output.get("url")

        if audio_url:
            dl_req = urllib.request.Request(audio_url, method="GET")
            with urllib.request.urlopen(dl_req, timeout=TIMEOUT) as dl_resp:
                audio_bytes = dl_resp.read()
            if not audio_bytes:
                raise RuntimeError("百炼音频下载结果为空")
            return audio_bytes

    raise RuntimeError(f"百炼/CosyVoice 响应格式异常: 未找到音频下载链接 — {str(raw[:200])}")


def _synthesize_gsv2p(text: str, cfg: dict) -> bytes:
    body = {
        "model": cfg.get("model") or GSV2P_MODEL,
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


def _synthesize_openai_compat(text: str, cfg: dict) -> bytes:
    body = {
        "model": cfg["model"],
        "input": text,
        "voice": cfg["voice"],
        "response_format": "wav",
    }
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    req = urllib.request.Request(
        cfg["url"], data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def _synthesize_fishaudio(text: str, cfg: dict) -> bytes:
    body: dict = {
        "text": text,
        "format": "wav",
    }
    if cfg.get("voice"):
        body["reference_id"] = cfg["voice"]
    req = urllib.request.Request(
        cfg["url"], data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
        },
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
        "siliconflow": _synthesize_openai_compat,
        "mimo": _synthesize_mimo,
        "cosyvoice": _synthesize_cosyvoice,
        "fishaudio": _synthesize_fishaudio,
        "gsv2p": _synthesize_gsv2p,
        "openai": _synthesize_openai_compat,
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
    app.router.add_post("/synthesize", handle_tts)
    app.router.add_route("OPTIONS", "/tts", handle_options)
    app.router.add_route("OPTIONS", "/synthesize", handle_options)
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

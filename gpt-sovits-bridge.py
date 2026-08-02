"""GPT-SoVITS bridge — 接收简单文本，转发到 GPT-SoVITS API。

参考音频（角色声线）配置优先级：请求体字段 > 环境变量 > 下方脚本常量。

环境变量（桌宠设置面板「服务路径配置」里填好后，启动桥时会自动注入）：
  DESKPET_GSV_REF_AUDIO    参考音频路径（.wav，建议 3~10 秒干净人声）
  DESKPET_GSV_PROMPT_TEXT  参考音频里说的文本内容
  DESKPET_GSV_API_URL      GPT-SoVITS API 地址（默认 http://127.0.0.1:9880/tts）
"""
import asyncio
import json
import os
import urllib.request

try:
    from aiohttp import web
except ImportError:
    import sys
    print(
        "[gpt-sovits-bridge] ERROR: 缺少依赖 aiohttp。"
        "该依赖由 MaiBot 插件自动安装，请先启动 MaiBot 加载插件；"
        "或手动执行：pip install aiohttp",
        file=sys.stderr,
    )
    raise

PORT = 9881
SOVITS_URL = os.environ.get("DESKPET_GSV_API_URL", "http://127.0.0.1:9880/tts")

# ── 默认角色声线：手动跑脚本时改这里；由桌宠拉起时以设置面板/环境变量为准 ──
REF_AUDIO_PATH = os.environ.get("DESKPET_GSV_REF_AUDIO", "")
PROMPT_TEXT = os.environ.get("DESKPET_GSV_PROMPT_TEXT", "")
PROMPT_LANG = "zh"
TEXT_LANG = "zh"
SPEED = 0.9        # 稍慢更自然
FRAGMENT_INTERVAL = 0.5  # 句间停顿
TEMPERATURE = 0.9  # 轻微随机感
TOP_K = 10         # 采样多样性
TOP_P = 0.9


def _resolve_ref_audio(body: dict) -> str:
    """请求体优先，其次桥默认配置；非字符串/空白一律视为未指定。"""
    raw = body.get("ref_audio_path")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return REF_AUDIO_PATH


async def handle_tts(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "text is empty"}, status=400)

    # 默认路径也必须过 isfile 校验 —— 此前默认路径被跳过，
    # 配置错了会一路捅到 GPT-SoVITS 才报一个看不懂的错
    ref_audio = _resolve_ref_audio(body)
    if not ref_audio:
        return web.json_response({
            "error": "未配置参考音频：桌宠设置面板 → 后台服务 → 服务路径配置，"
                     "或设置环境变量 DESKPET_GSV_REF_AUDIO"
        }, status=400)
    if not os.path.isfile(ref_audio):
        return web.json_response({"error": f"参考音频不存在: {ref_audio}"}, status=400)

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
    # 桌宠退出后自动跟着退出，避免孤儿进程占着端口
    try:
        import watchdog
        watchdog.start_watchdog()
    except ImportError as exc:
        print(f"[gpt-sovits-bridge] WARNING: watchdog 不可用，桥进程不会随桌宠退出: {exc!r}", flush=True)
    except Exception as exc:
        print(f"[gpt-sovits-bridge] ERROR: watchdog 启动失败: {exc!r}", flush=True)
        raise

    app = web.Application()
    app.router.add_post("/tts", handle_tts)
    app.router.add_route("OPTIONS", "/tts", handle_options)
    print(f"[gpt-sovits-bridge] listening on http://127.0.0.1:{PORT}/tts")
    print(f"[gpt-sovits-bridge] forwarding to {SOVITS_URL}")
    # 未配置/配置错误不算致命（请求方还能自带 ref_audio_path），但必须把话说清楚
    if not REF_AUDIO_PATH:
        print("[gpt-sovits-bridge] WARNING: 未配置参考音频，/tts 将返回 400。配置方式：")
        print("  桌宠启动：设置面板 → 后台服务 → 服务路径配置 → GPT-SoVITS 参考音频")
        print("  手动启动：设置环境变量 DESKPET_GSV_REF_AUDIO / DESKPET_GSV_PROMPT_TEXT，或改脚本顶部常量")
    elif not os.path.isfile(REF_AUDIO_PATH):
        print(f"[gpt-sovits-bridge] WARNING: 参考音频不存在: {REF_AUDIO_PATH}")
    web.run_app(app, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()

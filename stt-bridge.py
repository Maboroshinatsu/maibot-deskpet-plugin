"""SenseVoice STT bridge — 仅语音识别。"""
import asyncio
import os as _os
import tempfile
import threading
import wave

try:
    import numpy as np
    from aiohttp import web
except ImportError as exc:
    import sys
    print(
        f"[stt-bridge] ERROR: 缺少依赖 {exc.name}。"
        "该依赖由 MaiBot 插件自动安装，请先启动 MaiBot 加载插件；"
        "或手动执行：pip install aiohttp numpy",
        file=sys.stderr,
    )
    raise

PORT = 18530

# 候选模型目录：环境变量显式目录 -> 开发目录 -> 用户持久化数据目录（升级客户端不丢失）
_SCRIPT_DIR = _os.path.dirname(_os.path.abspath(__file__))
_DEV_MODEL_DIR = _os.path.join(_SCRIPT_DIR, "deskpet-app", "sensevoice")
_USER_MODEL_DIR = _os.environ.get("DESKPET_USER_SENSEVOICE_DIR") or _os.path.join(
    _os.environ.get("APPDATA") or _os.path.expanduser("~"),
    "maibot-deskpet",
    "sensevoice",
)

_MIRROR_BASES = [
    "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main",
    "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main",
]

_recognizer = None
_recognizer_lock = threading.Lock()
# sherpa-onnx 并发 decode 的线程安全性没有文档保证，解码段串行执行更稳
_decode_lock = threading.Lock()

# 16kHz 16bit 单声道 ≈ 32KB/s，50MB ≈ 26 分钟录音，罩住手动长录音场景
MAX_AUDIO_BYTES = 50 * 1024 * 1024


def _resolve_existing_model() -> tuple[str, str] | None:
    """在候选目录中查找已存在的模型（优先选择轻量快速的 model.int8.onnx，兼容旧版 model.onnx）。"""
    env_dir = _os.environ.get("DESKPET_SENSEVOICE_DIR", "").strip()
    candidates = [d for d in (env_dir, _USER_MODEL_DIR, _DEV_MODEL_DIR) if d]
    for folder in candidates:
        tokens = _os.path.join(folder, "tokens.txt")
        if not _os.path.isfile(tokens):
            continue
        for model_name in ("model.int8.onnx", "model.onnx"):
            model_path = _os.path.join(folder, model_name)
            if _os.path.isfile(model_path):
                return model_path, tokens
    return None


def _download_with_fallback(filename: str, dest_path: str) -> None:
    import urllib.request

    _os.makedirs(_os.path.dirname(dest_path), exist_ok=True)
    part_path = dest_path + ".part"
    last_err: Exception | None = None
    for base in _MIRROR_BASES:
        url = f"{base}/{filename}"
        try:
            print(f"[stt-bridge] 正在按需下载 {filename} <- {url}", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": "MaiBot-Deskpet/0.6"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(part_path, "wb") as out:
                total = int(resp.headers.get("Content-Length") or 0)
                downloaded = 0
                last_pct = -10
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = int(downloaded * 100 / total)
                        if pct >= last_pct + 10:
                            last_pct = pct
                            mb_done = downloaded / (1024 * 1024)
                            mb_total = total / (1024 * 1024)
                            print(
                                f"[stt-bridge] 下载进度 {filename}: {pct}% ({mb_done:.1f}/{mb_total:.1f} MB)",
                                flush=True,
                            )
            _os.replace(part_path, dest_path)
            print(f"[stt-bridge] 下载完成: {dest_path}", flush=True)
            return
        except Exception as exc:
            last_err = exc
            print(f"[stt-bridge] 从 {base} 下载 {filename} 失败: {exc}", flush=True)
            try:
                if _os.path.exists(part_path):
                    _os.unlink(part_path)
            except OSError:
                pass
    raise RuntimeError(f"无法按需下载本地离线 STT 模型 {filename}: {last_err}")


def _ensure_model_files() -> tuple[str, str]:
    existing = _resolve_existing_model()
    if existing:
        return existing
    target_dir = _os.environ.get("DESKPET_SENSEVOICE_DIR", "").strip() or _USER_MODEL_DIR
    _os.makedirs(target_dir, exist_ok=True)
    tokens_path = _os.path.join(target_dir, "tokens.txt")
    model_path = _os.path.join(target_dir, "model.int8.onnx")
    if not _os.path.isfile(tokens_path):
        _download_with_fallback("tokens.txt", tokens_path)
    if not _os.path.isfile(model_path):
        _download_with_fallback("model.int8.onnx", model_path)
    return model_path, tokens_path


def _get_stt():
    global _recognizer
    with _recognizer_lock:
        if _recognizer is None:
            try:
                import sherpa_onnx
            except ImportError:
                raise RuntimeError(
                    "缺少依赖 sherpa-onnx。该依赖由 MaiBot 插件自动安装，"
                    "请先启动 MaiBot 加载插件；或手动执行：pip install sherpa-onnx"
                )
            model_path, tokens_path = _ensure_model_files()
            _recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=model_path, tokens=tokens_path, language="zh"
            )
            print(f"[stt-bridge] model loaded: {model_path}", flush=True)
    return _recognizer


async def handle_stt(request: web.Request) -> web.Response:
    try:
        data = await request.read()
    except web.HTTPRequestEntityTooLarge:
        return web.json_response({"error": "audio too large (50MB, ~26min)"}, status=413)
    if not data:
        return web.json_response({"error": "empty body"}, status=400)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    def _transcribe() -> str:
        rec = _get_stt()
        stream = rec.create_stream()
        with wave.open(tmp_path, "rb") as wf:
            if wf.getsampwidth() != 2:
                raise ValueError(f"only 16-bit PCM supported, got {wf.getsampwidth() * 8}-bit")
            samples = wf.readframes(wf.getnframes())
            audio = np.frombuffer(samples, dtype=np.int16).astype(np.float32) / 32768.0
            channels = wf.getnchannels()
            if channels > 1:
                # 多声道取平均混为单声道，直接当单声道解会得到交错乱序的“音频”
                audio = audio.reshape(-1, channels).mean(axis=1)
            stream.accept_waveform(wf.getframerate(), audio)
        with _decode_lock:
            rec.decode_stream(stream)
        return stream.result.text

    try:
        # 模型首载数秒、解码数百毫秒，同步跑会冻住事件循环
        text = await asyncio.to_thread(_transcribe)
        return web.json_response({"text": text})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)
    finally:
        try:
            _os.unlink(tmp_path)
        except OSError:
            pass


def main() -> None:
    import sys

    existing = _resolve_existing_model()
    if existing:
        print(f"[stt-bridge] 已就绪本地模型: {existing[0]}", flush=True)
    else:
        print(
            f"[stt-bridge] 本地尚未缓存 SenseVoice 模型，首次语音识别时将自动下载轻量级 model.int8.onnx (~226MB) 至 {_USER_MODEL_DIR}",
            flush=True,
        )

    # 桌宠退出后自动跟着退出，避免孤儿进程占着端口
    try:
        import watchdog
        watchdog.start_watchdog()
    except ImportError as exc:
        print(f"[stt-bridge] WARNING: watchdog 不可用，桥进程不会随桌宠退出: {exc!r}", flush=True)
    except Exception as exc:
        print(f"[stt-bridge] ERROR: watchdog 启动失败: {exc!r}", flush=True)
        sys.exit(1)

    app = web.Application(client_max_size=MAX_AUDIO_BYTES)
    app.router.add_post("/stt", handle_stt)
    print(f"[stt-bridge] listening on http://127.0.0.1:{PORT}/stt", flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()

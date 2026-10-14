"""云 TTS 桥接服务单元测试。

测试 MiMo、CosyVoice、GSV2P 等多后端解析协议，无需联网或真实 API 密钥。
"""

import io
import json
import os
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import importlib.util
import types

# 准备 aiohttp 替身（如果未安装）
if "aiohttp" not in sys.modules:
    aiohttp_mock = types.ModuleType("aiohttp")
    aiohttp_mock.web = types.SimpleNamespace(
        Request=object,
        Response=lambda **kw: kw,
        json_response=lambda data, **kw: dict(data=data, **kw),
    )
    sys.modules["aiohttp"] = aiohttp_mock

spec = importlib.util.spec_from_file_location("cloud_tts_bridge", os.path.join(ROOT, "cloud-tts-bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CosyVoiceSynthesisTest(unittest.TestCase):
    def test_cosyvoice_downloads_audio_url_from_json(self):
        json_resp = json.dumps({
            "output": {
                "audio": {
                    "url": "https://dashscope.example.com/audio/sample.wav"
                }
            }
        }).encode("utf-8")
        fake_wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00"

        def _fake_urlopen(req, timeout=None):
            url = req.full_url if hasattr(req, "full_url") else str(req)
            if "sample.wav" in url:
                return io.BytesIO(fake_wav)
            if "SpeechSynthesizer" in url or "dashscope" in url:
                return io.BytesIO(json_resp)
            raise AssertionError(f"Unexpected URL: {url}")

        cfg = {
            "model": "qwen-audio-3.0-tts-flash",
            "voice": "cherry",
            "url": "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/SpeechSynthesizer",
            "api_key": "test-key",
        }

        with mock.patch.object(bridge.urllib.request, "urlopen", side_effect=_fake_urlopen):
            audio = bridge._synthesize_cosyvoice("测试文本", cfg)

        self.assertEqual(audio, fake_wav)

    def test_cosyvoice_direct_binary_audio_passthrough(self):
        fake_wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00"

        def _fake_urlopen(req, timeout=None):
            return io.BytesIO(fake_wav)

        cfg = {
            "model": "qwen-audio-3.0-tts-flash",
            "voice": "cherry",
            "url": "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/SpeechSynthesizer",
            "api_key": "test-key",
        }

        with mock.patch.object(bridge.urllib.request, "urlopen", side_effect=_fake_urlopen):
            audio = bridge._synthesize_cosyvoice("测试文本", cfg)

        self.assertEqual(audio, fake_wav)

    def test_cosyvoice_error_response_raises_runtime_error(self):
        err_json = json.dumps({
            "code": "InvalidApiKey",
            "message": "API key provided is invalid"
        }).encode("utf-8")

        def _fake_urlopen(req, timeout=None):
            return io.BytesIO(err_json)

        cfg = {
            "model": "qwen-audio-3.0-tts-flash",
            "voice": "cherry",
            "url": "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/SpeechSynthesizer",
            "api_key": "test-key",
        }

        with mock.patch.object(bridge.urllib.request, "urlopen", side_effect=_fake_urlopen):
            with self.assertRaises(RuntimeError) as ctx:
                bridge._synthesize_cosyvoice("测试文本", cfg)

        self.assertIn("InvalidApiKey", str(ctx.exception))


class MimoSynthesisTest(unittest.TestCase):
    """MiMo：目标文本放 assistant，风格指令放 user（官方文档要求）。"""

    FAKE_WAV = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00"

    def _capture(self, cfg, text):
        captured = {}
        payload = {"choices": [{"message": {"audio": {"data": bridge.base64.b64encode(self.FAKE_WAV).decode()}}}]}

        def _fake_urlopen(req, timeout=None):
            captured["body"] = json.loads(req.data.decode("utf-8"))
            return io.BytesIO(json.dumps(payload).encode("utf-8"))

        with mock.patch.object(bridge.urllib.request, "urlopen", side_effect=_fake_urlopen):
            audio = bridge._synthesize_mimo(text, cfg)
        return captured["body"], audio

    def _cfg(self, **kw):
        base = {"model": "mimo-v2.5-tts", "voice": "mimo_default",
                "url": bridge.MIMO_URL, "api_key": "k"}
        base.update(kw)
        return base

    def test_style_becomes_user_message(self):
        body, audio = self._capture(self._cfg(style="轻快、略带笑意，语速稍快"), "你好呀")
        self.assertEqual(body["messages"][0], {"role": "user", "content": "轻快、略带笑意，语速稍快"})
        self.assertEqual(body["messages"][1], {"role": "assistant", "content": "你好呀"})
        self.assertEqual(body["audio"]["format"], "wav")
        self.assertEqual(audio, self.FAKE_WAV)

    def test_no_style_sends_only_assistant(self):
        body, _ = self._capture(self._cfg(style=""), "你好呀")
        self.assertEqual(len(body["messages"]), 1)
        self.assertEqual(body["messages"][0]["role"], "assistant")

    def test_voicedesign_requires_style(self):
        env = {
            "DESKPET_TTS_BACKEND": "mimo",
            "DESKPET_MIMO_API_KEY": "k",
            "DESKPET_MIMO_MODEL": "mimo-v2.5-tts-voicedesign",
            "DESKPET_TTS_STYLE": "",
            "DESKPET_MIMO_STYLE": "",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            _backend, cfg = bridge._backend_config()
        self.assertIn("error", cfg)
        self.assertIn("voicedesign", cfg["error"])

    def test_voicedesign_ok_with_style(self):
        env = {
            "DESKPET_TTS_BACKEND": "mimo",
            "DESKPET_MIMO_API_KEY": "k",
            "DESKPET_MIMO_MODEL": "mimo-v2.5-tts-voicedesign",
            "DESKPET_MIMO_STYLE": "温柔的女声，语速偏慢",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            _backend, cfg = bridge._backend_config()
        self.assertNotIn("error", cfg)
        self.assertEqual(cfg["style"], "温柔的女声，语速偏慢")

if __name__ == "__main__":
    unittest.main(verbosity=2)

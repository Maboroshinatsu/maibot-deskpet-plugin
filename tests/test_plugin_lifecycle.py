"""DP008 生命周期与卸载收尾回归测试。

仅使用标准库 unittest/IsolatedAsyncioTestCase，以及 sys.modules 中的
maibot_sdk / aiohttp / websockets 测试替身；不安装依赖、不建立真实网络、
不启动真实服务，也不触碰任何麦克风/录音/VAD/PTT 路径。

运行：
  python -B -m unittest discover -s tests -p "test_plugin_lifecycle.py" -v
  python -B tests/test_plugin_lifecycle.py
"""

import asyncio
import os
import sys
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


# ── SDK / 网络依赖替身（只存在于 sys.modules，不落盘、不联网） ──

class _FakePluginConfigBase:
    def __init__(self, **kwargs):
        pass


class _FakeFieldInfo:
    def __init__(self, default=None, default_factory=None, description=""):
        self.default = default
        self.default_factory = default_factory


def _fake_field(default=None, default_factory=None, description="", **kwargs):
    return _FakeFieldInfo(default=default, default_factory=default_factory, description=description)


class _FakeMaiBotPlugin:
    def __init__(self, *args, **kwargs):
        pass


class _FakeTool:
    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, fn):
        return fn


class _FakeMessageGateway:
    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, fn):
        return fn


class _FakeToolParameterInfo:
    def __init__(self, *args, **kwargs):
        pass


class _FakeToolParamType:
    STRING = "string"
    BOOLEAN = "boolean"


async def _unused_session(*args, **kwargs):
    raise AssertionError("测试替身不应建立真实 aiohttp 会话")


async def _unused_serve(*args, **kwargs):
    raise AssertionError("测试替身不应启动真实 websocket 服务")


class _FakeConnectionClosed(Exception):
    pass


def _install_fake_deps() -> None:
    sdk = types.ModuleType("maibot_sdk")
    sdk.MaiBotPlugin = _FakeMaiBotPlugin
    sdk.Tool = _FakeTool
    sdk.MessageGateway = _FakeMessageGateway
    sdk.PluginConfigBase = _FakePluginConfigBase
    sdk.Field = _fake_field

    sdk_types = types.ModuleType("maibot_sdk.types")
    sdk_types.ToolParameterInfo = _FakeToolParameterInfo
    sdk_types.ToolParamType = _FakeToolParamType
    sdk.types = sdk_types

    sys.modules["maibot_sdk"] = sdk
    sys.modules["maibot_sdk.types"] = sdk_types

    aiohttp = types.ModuleType("aiohttp")
    aiohttp.ClientSession = _unused_session
    aiohttp.ClientTimeout = lambda *a, **k: None
    sys.modules["aiohttp"] = aiohttp

    websockets = types.ModuleType("websockets")
    websockets.ConnectionClosed = _FakeConnectionClosed
    websockets.WebSocketServerProtocol = type("FakeWebSocketServerProtocol", (), {})
    websockets.serve = _unused_serve
    sys.modules["websockets"] = websockets


_install_fake_deps()

import plugin  # noqa: E402  —— 必须在替身装好之后导入


# ── 测试用假对象 ──

class _FakeLogger:
    def __init__(self):
        self.records = []

    def _log(self, level, msg):
        self.records.append((level, str(msg)))

    def debug(self, msg, *a, **k):
        self._log("debug", msg)

    def info(self, msg, *a, **k):
        self._log("info", msg)

    def warning(self, msg, *a, **k):
        self._log("warning", msg)

    def error(self, msg, *a, **k):
        self._log("error", msg)

    def messages(self):
        return [m for _lvl, m in self.records]

    def contains(self, needle):
        return any(needle in m for m in self.messages())


class _FakeGateway:
    def __init__(self, fail_update_state=False):
        self.fail_update_state = fail_update_state
        self.update_calls = []
        self.routed = []

    async def update_state(self, **kwargs):
        self.update_calls.append(kwargs)
        if self.fail_update_state:
            raise RuntimeError("gateway offline")

    async def route_message(self, **kwargs):
        self.routed.append(kwargs)
        return True


class _FakeCtx:
    def __init__(self, gateway=None):
        self.logger = _FakeLogger()
        self.gateway = gateway or _FakeGateway()


class _FakeServer:
    """记录 broadcast 的假 WS 服务器；send_hook 可模拟断开/抛错/卸载。"""

    def __init__(self, send_hook=None):
        self.sent = []
        self.send_hook = send_hook
        self.has_clients = True
        self.stopped = 0

    async def broadcast(self, msg_type, data, request_id=None):
        self.sent.append((msg_type, data, request_id))
        if self.send_hook is not None:
            self.send_hook(msg_type)

    async def stop(self):
        self.stopped += 1

    def types(self):
        return [t for t, _d, _r in self.sent]


class _FakeWS:
    """仅模拟协议面（remote_address/send/__aiter__），不建立真实连接。"""

    def __init__(self, send_error=None, incoming=()):
        self.remote_address = ("127.0.0.1", 12345)
        self.send_error = send_error
        self.sent = []
        self._incoming = list(incoming)

    async def send(self, raw):
        if self.send_error is not None:
            raise self.send_error
        self.sent.append(raw)

    def __aiter__(self):
        async def _gen():
            for item in self._incoming:
                yield item

        return _gen()


def _make_plugin(tts_enabled=False, gateway=None):
    plug = plugin.DeskpetPlugin()
    plug.ctx = _FakeCtx(gateway)
    plug._last_tool_emotion_at = 0.0
    plug._ws_server = None
    plug._model_emotions = set()
    plug._bg_tasks = set()
    plug._closing = False
    plug.config = types.SimpleNamespace(
        plugin=types.SimpleNamespace(enabled=True),
        ws_server=types.SimpleNamespace(host="127.0.0.1", port=8523, auth_token=""),
        chat=types.SimpleNamespace(stream_buffer_size=50),
        tts=types.SimpleNamespace(enabled=tts_enabled, url="http://127.0.0.1:9881/tts", timeout=5),
    )
    return plug


# ── 1. env 握手断开清理 ──

class EnvHandshakeCleanupTest(unittest.IsolatedAsyncioTestCase):
    async def test_env_handshake_disconnect_removes_client(self):
        server = plugin.DeskpetWSServer(
            host="127.0.0.1", port=0, plugin=None, logger=_FakeLogger(), auth_token="",
        )
        ws = _FakeWS(send_error=plugin.websockets.ConnectionClosed("client gone"))

        await server._handle_client(ws)

        self.assertNotIn(ws, server._clients)
        self.assertFalse(server.has_clients)
        self.assertEqual(server._clients, set())

    async def test_env_handshake_generic_error_removes_client(self):
        server = plugin.DeskpetWSServer(
            host="127.0.0.1", port=0, plugin=None, logger=_FakeLogger(), auth_token="",
        )
        ws = _FakeWS(send_error=RuntimeError("half-open socket"))

        await server._handle_client(ws)

        self.assertNotIn(ws, server._clients)
        self.assertFalse(server.has_clients)

    async def test_env_handshake_success_also_cleans_up(self):
        server = plugin.DeskpetWSServer(
            host="127.0.0.1", port=0, plugin=None, logger=_FakeLogger(), auth_token="",
        )
        ws = _FakeWS(incoming=[])

        await server._handle_client(ws)

        self.assertNotIn(ws, server._clients)
        self.assertEqual(len(ws.sent), 1)
        self.assertIn("sys:env", ws.sent[0])


# ── 2/3/4. 卸载收尾 ──

class UnloadTeardownTest(unittest.IsolatedAsyncioTestCase):
    async def test_gateway_failure_still_stops_and_clears(self):
        gateway = _FakeGateway(fail_update_state=True)
        plug = _make_plugin(gateway=gateway)
        server = _FakeServer()
        plug._ws_server = server

        await plug.on_unload()

        self.assertIsNone(plug._ws_server)
        self.assertTrue(plug._closing)
        self.assertEqual(server.stopped, 1)
        self.assertEqual([c.get("ready") for c in gateway.update_calls], [False])
        self.assertTrue(plug.ctx.logger.contains("Gateway unready notify failed"))

    async def test_unload_cancels_and_awaits_bg_tasks(self):
        plug = _make_plugin()
        server = _FakeServer()
        plug._ws_server = server

        started = asyncio.Event()
        cleaned = asyncio.Event()

        async def slow_task():
            started.set()
            try:
                await asyncio.sleep(3600)
            finally:
                cleaned.set()

        task = asyncio.create_task(slow_task())
        plug._bg_tasks.add(task)
        await started.wait()

        await plug.on_unload()

        self.assertTrue(task.done())
        self.assertTrue(task.cancelled())
        self.assertTrue(cleaned.is_set())
        self.assertEqual(plug._bg_tasks, set())
        self.assertIsNone(plug._ws_server)
        self.assertEqual(server.stopped, 1)

    async def test_no_new_tts_task_after_unload_started(self):
        plug = _make_plugin(tts_enabled=True)
        server = _FakeServer()
        plug._ws_server = server
        plug._closing = True

        created = []
        real_create_task = asyncio.create_task

        def _spy_create_task(coro, **kwargs):
            created.append(coro)
            return real_create_task(coro)

        with mock.patch.object(plugin.asyncio, "create_task", new=_spy_create_task):
            result = await plug.send_to_deskpet({"processed_plain_text": "你好世界"})

        self.assertFalse(result["success"])
        self.assertEqual(created, [])
        self.assertEqual(plug._bg_tasks, set())
        self.assertEqual(server.sent, [])

    async def test_unload_during_chunked_send_stops_without_error(self):
        plug = _make_plugin(tts_enabled=False)
        server = _FakeServer()

        def hook(msg_type):
            if msg_type == "output:text:delta":
                # 模拟分块发送中途 on_unload 收尾：置标记并清空服务器引用
                plug._closing = True
                plug._ws_server = None

        server.send_hook = hook
        plug._ws_server = server

        result = await plug.send_to_deskpet({"processed_plain_text": "x" * 200})

        self.assertFalse(result["success"])
        self.assertIn("output:text:delta", server.types())
        self.assertNotIn("output:text:done", server.types())


# ── 5. 正常文本输出（旧协议不变） ──

class NormalReplyTest(unittest.IsolatedAsyncioTestCase):
    async def test_normal_text_output_broadcasts_deltas_and_done(self):
        plug = _make_plugin(tts_enabled=False)
        server = _FakeServer()
        plug._ws_server = server

        result = await plug.send_to_deskpet({"processed_plain_text": "你好世界"})

        self.assertTrue(result["success"])
        self.assertEqual(server.types(), ["output:text:delta", "output:text:done"])
        deltas = [d["delta"] for t, d, _r in server.sent if t == "output:text:delta"]
        self.assertEqual("".join(deltas), "你好世界")
        self.assertEqual(plug._bg_tasks, set())

    async def test_normal_text_output_keeps_emotion_broadcast(self):
        plug = _make_plugin(tts_enabled=False)
        server = _FakeServer()
        plug._ws_server = server

        result = await plug.send_to_deskpet({"processed_plain_text": "今天好开心呀"})

        self.assertTrue(result["success"])
        self.assertEqual(server.types()[0], "state:emotion")
        self.assertEqual(server.sent[0][1], {"emotion": "happy"})
        self.assertIn("output:text:done", server.types())


# ── 6. 后台任务异常回收 ──

class BgTaskReapTest(unittest.IsolatedAsyncioTestCase):
    async def test_bg_task_exception_is_reaped(self):
        plug = _make_plugin(tts_enabled=True)
        server = _FakeServer()
        plug._ws_server = server

        async def _boom(text, req_id):
            raise RuntimeError("tts exploded")

        plug._send_tts_audio = _boom

        loop = asyncio.get_running_loop()
        handled = []
        old_handler = loop.get_exception_handler()

        def _capture(loop_, context):
            handled.append(context)

        loop.set_exception_handler(_capture)
        try:
            result = await plug.send_to_deskpet({"processed_plain_text": "你好世界"})
            self.assertTrue(result["success"])
            tasks = list(plug._bg_tasks)
            self.assertEqual(len(tasks), 1)
            await asyncio.gather(*tasks, return_exceptions=True)
            await asyncio.sleep(0)
        finally:
            loop.set_exception_handler(old_handler)

        self.assertEqual(plug._bg_tasks, set())
        self.assertEqual(handled, [])
        self.assertTrue(plug.ctx.logger.contains("Background task failed"))
        self.assertTrue(plug.ctx.logger.contains("tts exploded"))


class BoundedUnloadTest(unittest.IsolatedAsyncioTestCase):
    """DP008：网关或后台任务不响应时，卸载仍必须有界完成，WS 服务器必须停止。"""

    async def test_hanging_gateway_still_stops_server(self):
        class _HangingGateway:
            def __init__(self):
                self.update_calls = []

            async def update_state(self, **kwargs):
                self.update_calls.append(kwargs)
                await asyncio.Event().wait()  # 永不返回

            async def route_message(self, **kwargs):
                return True

        gateway = _HangingGateway()
        plug = _make_plugin(gateway=gateway)
        plug.UNLOAD_TIMEOUT_SECONDS = 0.05
        server = _FakeServer()
        plug._ws_server = server

        await asyncio.wait_for(plug.on_unload(), timeout=5)

        self.assertIsNone(plug._ws_server)
        self.assertTrue(plug._closing)
        self.assertEqual(server.stopped, 1)
        self.assertEqual([c.get("ready") for c in gateway.update_calls], [False])
        self.assertTrue(plug.ctx.logger.contains("Gateway unready notify timed out"))

    async def test_task_swallowing_cancellation_still_stops_server(self):
        plug = _make_plugin()
        plug.UNLOAD_TIMEOUT_SECONDS = 0.05
        server = _FakeServer()
        plug._ws_server = server

        async def stubborn():
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                # 吞掉第一次取消：wait_for/gather 会一直等，asyncio.wait 必须到点返回
                await asyncio.sleep(3600)

        task = asyncio.create_task(stubborn())
        plug._bg_tasks.add(task)
        await asyncio.sleep(0)

        await asyncio.wait_for(plug.on_unload(), timeout=5)

        self.assertIsNone(plug._ws_server)
        self.assertEqual(server.stopped, 1)
        self.assertTrue(plug.ctx.logger.contains("后台任务取消超时"))

        task.cancel()
        try:
            await task
        except BaseException:
            pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
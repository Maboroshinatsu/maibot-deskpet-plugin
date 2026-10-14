"""MaiBot Deskpet Plugin — 桌面宠物 Live2D 插件

将 MaiBot 的 AI 能力与 Live2D 桌面宠物应用桥接。
通过 MessageGateway 将桌宠输入注入 MaiBot 消息管线，由 Maisaka 推理引擎处理后返回回复。
WebSocket 服务器监听 ws://127.0.0.1:8523，供 Electron 前端连接。
"""

import asyncio
import hashlib
import json
import re
import sys
import time
import uuid
import base64

import random

import aiohttp
from dataclasses import dataclass, field
from logging import Logger
from typing import Any, Dict, Optional, Set

import websockets

from maibot_sdk import MaiBotPlugin, Tool, MessageGateway, PluginConfigBase, Field
from maibot_sdk.types import ToolParameterInfo, ToolParamType


# ═══════════════════════════════════════════════
# Config
# ═══════════════════════════════════════════════

class PluginCoreConfig(PluginConfigBase):
    __ui_label__ = "插件"
    __ui_icon__ = "package"
    __ui_order__ = 0
    enabled: bool = Field(default=True, description="是否启用插件")
    config_version: str = Field(default="1.0.8", description="配置版本")


class WSServerConfig(PluginConfigBase):
    __ui_label__ = "WebSocket"
    __ui_icon__ = "wifi"
    __ui_order__ = 1
    host: str = Field(default="127.0.0.1", description="监听地址，跨设备时设为 0.0.0.0")
    port: int = Field(default=8523, description="监听端口")
    auth_token: str = Field(default="", description="鉴权令牌；留空则不校验连接来源（本机任意程序可连接，跨设备或本机多人共用时务必设置）")


class ChatConfig(PluginConfigBase):
    __ui_label__ = "对话"
    __ui_icon__ = "message-circle"
    __ui_order__ = 2
    stream_buffer_size: int = Field(default=50, description="流式文本每次推送的字符数")


class TTSConfig(PluginConfigBase):
    __ui_label__ = "语音合成"
    __ui_icon__ = "volume-2"
    __ui_order__ = 3
    enabled: bool = Field(default=True, description="是否让桌宠朗读回复语音（实际合成在桌宠端本地完成）")
    # 语音合成已改为在桌宠端本地完成，插件不再请求 TTS 桥。
    # 以下字段仅保留以兼容既有 config.toml（避免加载时报未知字段），不再生效。
    url: str = Field(default="http://127.0.0.1:9881/tts", description="[已弃用] 合成改由桌宠端本地完成，此项不再生效")
    timeout: int = Field(default=60, description="[已弃用] 合成改由桌宠端本地完成，此项不再生效")


class DeskpetPluginConfig(PluginConfigBase):
    plugin: PluginCoreConfig = Field(default_factory=PluginCoreConfig)
    ws_server: WSServerConfig = Field(default_factory=WSServerConfig)
    chat: ChatConfig = Field(default_factory=ChatConfig)
    tts: TTSConfig = Field(default_factory=TTSConfig)


# ═══════════════════════════════════════════════
# Protocol
# ═══════════════════════════════════════════════

EMOTION_LIST = [
    "happy", "sad", "angry", "surprise", "embarrassed",
    "thinking", "shy", "curious", "confused", "neutral", "idle"
]

TOOL_EMOTION_SUPPRESS_SECONDS = 3.0

# 自动情绪推断的关键词（按 dict 顺序首个命中生效）
EMOTION_KEYWORDS = {
    "surprise": ("哇", "竟然", "真的假的", "不会吧", "惊讶", "震惊"),
    "angry": ("生气", "讨厌", "烦", "过分", "不理你", "哼", "可恶"),
    "sad": ("难过", "伤心", "呜", "哭", "失落", "对不起", "抱歉"),
    "shy": ("害羞", "脸红", "不好意思", "欸嘿"),
    "embarrassed": ("尴尬", "社死", "脚趾", "啊这", "汗颜", "无地自容", "呃呃"),
    "happy": ("开心", "高兴", "喜欢", "太好了", "好耶", "哈哈", "嘿嘿", "嘻嘻"),
    "thinking": ("我想想", "让我想想", "可能", "也许", "应该是", "大概"),
    "curious": ("为什么", "怎么会", "是什么", "好奇", "想知道"),
    "confused": ("搞不懂", "什么情况", "怎么回事", "哈？", "啊？", "懵", "纳闷", "困惑"),
}

ACTION_LIST = [
    "wave", "jump", "spin", "sit", "sleep", "wake", "dance", "cheer"
]


# 出站文本里可能混入的媒体占位标记（如「[表情包: 摸摸头]」「[图片]」）。
# 这些标记由 MaiBot 把 emoji / image 组件渲染成文本而来，不是回复正文，
# 不应被当作台词念出来，也不该显示在气泡里。
MEDIA_PLACEHOLDER_RE = re.compile(r"\[(?:表情包|图片)(?:[：:][^\]]*)?\]")


def clean_outbound_text(text: Any) -> str:
    """统一的出站文本后处理：剥离媒体占位标记并去除首尾空白。

    raw_message 的 text 组件、processed_plain_text 回退、以及新旧字段回退
    都必须走这一步，否则同一段文本会因走的分支不同而清洗结果不一致：
    raw_message 分支曾漏掉媒体占位过滤，把「表情包: 某某」直接念了出来。
    """
    return MEDIA_PLACEHOLDER_RE.sub("", str(text)).strip()


@dataclass
class DeskpetMessage:
    type: str
    data: dict = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    request_id: Optional[str] = None

    def to_json(self) -> str:
        return json.dumps(
            {"type": self.type, "data": self.data, "timestamp": self.timestamp, "request_id": self.request_id},
            ensure_ascii=False,
        )

    @staticmethod
    def from_json(raw: str) -> "DeskpetMessage":
        obj = json.loads(raw)
        return DeskpetMessage(
            type=obj.get("type", ""),
            data=obj.get("data", {}),
            timestamp=obj.get("timestamp", time.time()),
            request_id=obj.get("request_id"),
        )


# ═══════════════════════════════════════════════
# WebSocket Server
# ═══════════════════════════════════════════════

class DeskpetWSServer:
    def __init__(self, host: str, port: int, plugin: "DeskpetPlugin", logger: Logger, auth_token: str = ""):
        self.host = host
        self.port = port
        self.plugin = plugin
        self.logger = logger
        self.auth_token = auth_token
        self._server = None
        self._clients: Set[websockets.WebSocketServerProtocol] = set()

    @staticmethod
    def _extract_origin(ws) -> Optional[str]:
        """读取握手 Origin 头，兼容 websockets 新旧两种连接对象。

        - websockets >= 14：连接对象是 ServerConnection，只有 .request.headers
        - websockets < 14：连接对象是 WebSocketServerProtocol，有 .origin / .request_headers

        任一读取失败都返回 None（等价于「无 Origin 头」）。
        """
        req = getattr(ws, "request", None)
        headers = getattr(req, "headers", None) if req is not None else None
        if headers is not None:
            try:
                origin = headers.get("Origin")
            except Exception:
                origin = None
            if origin is not None:
                return origin
        origin = getattr(ws, "origin", None)
        if origin is not None:
            return origin
        req_headers = getattr(ws, "request_headers", None)
        if req_headers is not None:
            try:
                return req_headers.get("Origin")
            except Exception:
                return None
        return None

    @staticmethod
    def _is_trusted_origin(origin: Optional[str]) -> bool:
        if not origin:
            return True  # 桌面端原生/IPC（无 Origin 头）、脚本或本地进程
        norm = origin.strip().lower()
        # Electron 桌面端：打包态渲染进程 Origin 实测为 file://（开发态走下方回环分支）。
        # 刻意不信任 "null"：浏览器中沙箱 iframe / data: 页面的 Origin 即 null，属网页可达来源。
        if norm in ("file://", "deskpet://"):
            return True
        if norm.startswith(("deskpet://", "vscode-webview://")):
            return True
        if norm.startswith(("http://localhost:", "http://127.0.0.1:", "http://[::1]:", "https://localhost:", "https://127.0.0.1:")):
            return True
        if norm in ("http://localhost", "http://127.0.0.1", "http://[::1]"):
            return True
        return False

    async def start(self):
        self._server = await websockets.serve(
            self._handle_client, self.host, self.port, ping_interval=30, ping_timeout=10,
            max_size=20_000_000,
        )
        self.logger.info(f"[Deskpet] WebSocket server started on ws://{self.host}:{self.port}")

    async def stop(self):
        if self._server:
            self._server.close()
            try:
                await asyncio.wait_for(self._server.wait_closed(), timeout=2.0)
            except asyncio.TimeoutError:
                self.logger.warning("[Deskpet] WebSocket wait_closed timed out, forcing client teardown")
            for client in list(self._clients):
                try:
                    await client.close(1001, "Server shutting down")
                except Exception:
                    pass
            self._clients.clear()
            self.logger.info("[Deskpet] WebSocket server stopped")

    async def broadcast(self, msg_type: str, data: dict, request_id: str = None):
        msg = DeskpetMessage(type=msg_type, data=data, request_id=request_id).to_json()
        disconnected = set()
        # 快照遍历：await send 期间 _handle_client 可能增删 _clients，
        # 直接遍历活集合会 RuntimeError 并中断整条回复
        for client in list(self._clients):
            try:
                await client.send(msg)
            except websockets.ConnectionClosed:
                disconnected.add(client)
        self._clients -= disconnected

    @property
    def has_clients(self) -> bool:
        return len(self._clients) > 0

    async def _handle_client(self, ws: websockets.WebSocketServerProtocol):
        origin = self._extract_origin(ws)

        # 检查网页 Origin：若来源于外部不可信网页且未配置鉴权令牌，拒绝握手
        if not self._is_trusted_origin(origin) and not self.auth_token:
            self.logger.warning(f"[Deskpet] Rejected untrusted Origin without token: {origin} from {ws.remote_address}")
            await ws.close(4003, "Forbidden origin")
            return

        if self.auth_token:
            authorized = False
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                msg = DeskpetMessage.from_json(raw)
                authorized = msg.type == "auth" and isinstance(msg.data, dict) and msg.data.get("token") == self.auth_token
                if not authorized:
                    self.logger.warning(f"[Deskpet] Auth failed from {ws.remote_address}")
            except asyncio.TimeoutError:
                self.logger.warning(f"[Deskpet] Auth timeout from {ws.remote_address}")
            except websockets.ConnectionClosed:
                return
            except Exception as e:
                # 畸形 JSON / 非 dict 帧等，不能让异常炸穿 handler
                self.logger.warning(f"[Deskpet] Bad auth frame from {ws.remote_address}: {e}")
            if not authorized:
                await ws.close(4001, "Unauthorized")
                return
            self.logger.info(f"[Deskpet] Client authenticated: {ws.remote_address}")

        self._clients.add(ws)
        addr = ws.remote_address
        self.logger.info(f"[Deskpet] Client connected: {addr}")
        # 登记进 _clients 之后的所有路径（含 sys:env 发送）都走同一个 try/finally，
        # 任何断开/发送异常都必须把客户端移除，否则半开连接会永久留在集合里
        try:
            # 上报插件所在 Python 解释器：桌宠的 STT/TTS 桥复用 MaiBot 的 Python 环境
            # （依赖已按 manifest 装进同一环境），用户无需单独安装 Python
            await ws.send(DeskpetMessage(type="sys:env", data={"python": sys.executable}).to_json())
            async for raw in ws:
                try:
                    msg = DeskpetMessage.from_json(raw)
                    await self.plugin.handle_client_message(msg, ws)
                except Exception as e:
                    self.logger.warning(f"[Deskpet] Bad message: {e}")
        except websockets.ConnectionClosed:
            pass
        except Exception as e:
            # 非 ConnectionClosed 的发送/接收异常（半开连接等）同样要收尾
            self.logger.warning(f"[Deskpet] Client loop error from {addr}: {e}")
        finally:
            self._clients.discard(ws)
            self.logger.info(f"[Deskpet] Client disconnected: {addr}")


# ═══════════════════════════════════════════════
# Plugin
# ═══════════════════════════════════════════════

class DeskpetPlugin(MaiBotPlugin):
    config_model = DeskpetPluginConfig

    GATEWAY_NAME = "deskpet_gateway"
    DESKPET_PLATFORM = "deskpet"
    DESKPET_ACCOUNT_ID = "deskpet-bot"
    DESKPET_SCOPE = "default"
    DESKPET_USER_ID = "deskpet-user"

    # 卸载是有界操作：网关/后台任务不响应时不能永久卡住收尾，否则 WS 服务器永不停止。
    # 测试可通过覆盖该属性缩短等待。
    UNLOAD_TIMEOUT_SECONDS = 5.0

    async def on_load(self) -> None:
        self._last_tool_emotion_at = 0.0
        self._ws_server: Optional[DeskpetWSServer] = None
        # 当前模型声明的自定义情绪（桌宠经 sys:emotions 上报，与内置词表取并集）
        self._model_emotions: Set[str] = set()
        # 当前模型可用的持久控件清单（桌宠经 sys:controls 上报，含 id/label/category/active）
        self._model_controls: list[Dict[str, Any]] = []
        # 当前模型可用的状态组合预设（含用户自定义命名组合与内置组合）
        self._model_presets: list[Dict[str, Any]] = []
        # 事件循环只持任务的弱引用，fire-and-forget 的 TTS 任务必须自己留强引用
        self._bg_tasks: Set[asyncio.Task] = set()
        # 卸载开始后置位：拒绝新的出站/TTS 任务，并让分块发送提前收手
        self._closing = False
        if not self.config.plugin.enabled:
            return

        if self.config.ws_server.host not in ("127.0.0.1", "localhost", "::1") and not self.config.ws_server.auth_token:
            self.ctx.logger.warning(
                "[Deskpet] WebSocket 监听非回环地址且未设置 auth_token："
                "任何局域网主机都能向 MaiBot 注入消息并接收全部回复，强烈建议配置鉴权令牌"
            )

        self._ws_server = DeskpetWSServer(
            host=self.config.ws_server.host,
            port=self.config.ws_server.port,
            plugin=self,
            logger=self.ctx.logger,
            auth_token=self.config.ws_server.auth_token,
        )
        await self._ws_server.start()

        await self.ctx.gateway.update_state(
            gateway_name=self.GATEWAY_NAME,
            ready=True,
            platform=self.DESKPET_PLATFORM,
            account_id=self.DESKPET_ACCOUNT_ID,
            scope=self.DESKPET_SCOPE,
        )
        self.ctx.logger.info("[Deskpet] Gateway ready, platform=deskpet")

    async def on_unload(self) -> None:
        # 最先立 closing 标记：卸载开始后不再接受新的出站/TTS 任务
        self._closing = True
        try:
            # 先取消并等待后台任务，再通知网关下线：这样即使 gateway 挂起/被取消，
            # 也不会还有后台 TTS 请求在卸载过程中继续跑
            try:
                # 取消并等待后台任务（内部有界，见 _cancel_bg_tasks）
                await self._cancel_bg_tasks()
            finally:
                await self._notify_gateway_unready()
        finally:
            # 无论上面哪一步报错（含 CancelledError），都必须停服务器并清空引用
            server, self._ws_server = self._ws_server, None
            if server:
                try:
                    await server.stop()
                except Exception as e:
                    self.ctx.logger.warning(f"[Deskpet] WS server stop failed: {e}")

    async def _cancel_bg_tasks(self) -> None:
        """取消后台任务并在有界时间内等待，确保卸载不无限挂起。

        用 asyncio.wait 而不是 wait_for/gather：任务若吞掉 CancelledError，
        wait_for 仍会一直等它结束，而 wait 到点即返回，收尾不会被拖住。
        """
        tasks = [t for t in self._bg_tasks if not t.done()]
        self._bg_tasks.clear()
        for task in tasks:
            task.cancel()
        if not tasks:
            return
        done, pending = await asyncio.wait(tasks, timeout=self.UNLOAD_TIMEOUT_SECONDS)
        if pending:
            self.ctx.logger.warning(
                f"[Deskpet] 后台任务取消超时，放弃等待 {len(pending)} 个任务"
            )
        # 回收已完成任务的异常，避免 "Task exception was never retrieved"
        for task in done:
            self._reap_bg_task(task)

    async def _notify_gateway_unready(self) -> None:
        """有界地通知网关下线；超时/异常都只记录，不阻断收尾。"""
        notify = asyncio.ensure_future(
            self.ctx.gateway.update_state(gateway_name=self.GATEWAY_NAME, ready=False)
        )
        done, pending = await asyncio.wait({notify}, timeout=self.UNLOAD_TIMEOUT_SECONDS)
        if pending:
            notify.cancel()
            self.ctx.logger.warning("[Deskpet] Gateway unready notify timed out")
            return
        exc = notify.exception()
        if exc is not None:
            self.ctx.logger.warning(f"[Deskpet] Gateway unready notify failed: {exc}")

    def _reap_bg_task(self, task: asyncio.Task) -> None:
        """后台任务完成回调：移出集合并读取异常，避免 never retrieved 告警。"""
        self._bg_tasks.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            self.ctx.logger.warning(f"[Deskpet] Background task failed: {exc}")

    async def on_config_update(self, scope: str, config_data: dict, version: str) -> None:
        self.ctx.logger.info(f"[Deskpet] Config updated: scope={scope}, version={version}")
        if self._closing:
            return

        enabled = getattr(self.config.plugin, "enabled", True)
        if not enabled:
            if self._ws_server:
                self.ctx.logger.info("[Deskpet] 插件已通过配置禁用，停止 WebSocket 服务与网关路由")
                await self._stop_ws_server()
                await self._notify_gateway_unready()
            return

        # 插件处于启用状态
        ws_cfg = self.config.ws_server
        if self._ws_server is None:
            self.ctx.logger.info("[Deskpet] 插件已通过配置启用，启动 WebSocket 服务")
            self._ws_server = DeskpetWSServer(
                host=ws_cfg.host,
                port=ws_cfg.port,
                plugin=self,
                logger=self.ctx.logger,
                auth_token=ws_cfg.auth_token,
            )
            try:
                await self._ws_server.start()
                await self.ctx.gateway.update_state(
                    gateway_name=self.GATEWAY_NAME,
                    ready=True,
                    platform=self.DESKPET_PLATFORM,
                    account_id=self.DESKPET_ACCOUNT_ID,
                    scope=self.DESKPET_SCOPE,
                )
            except Exception as e:
                self.ctx.logger.error(f"[Deskpet] WebSocket 服务启动失败: {e}")
            return

        # 服务器正在运行，检查 host / port / auth_token 变更
        need_rebind = self._ws_server.host != ws_cfg.host or self._ws_server.port != ws_cfg.port
        if need_rebind:
            self.ctx.logger.info(
                f"[Deskpet] WebSocket 监听地址/端口变更 ({self._ws_server.host}:{self._ws_server.port} -> {ws_cfg.host}:{ws_cfg.port})，重启服务"
            )
            await self._stop_ws_server()
            self._ws_server = DeskpetWSServer(
                host=ws_cfg.host,
                port=ws_cfg.port,
                plugin=self,
                logger=self.ctx.logger,
                auth_token=ws_cfg.auth_token,
            )
            try:
                await self._ws_server.start()
            except Exception as e:
                self.ctx.logger.error(f"[Deskpet] WebSocket 服务重启失败: {e}")
        elif self._ws_server.auth_token != ws_cfg.auth_token:
            self.ctx.logger.info("[Deskpet] WebSocket 鉴权令牌已更新")
            self._ws_server.auth_token = ws_cfg.auth_token

    # ── MessageGateway: 出站 (MaiBot → 桌宠) ──

    @MessageGateway(
        route_type="duplex",
        name=GATEWAY_NAME,
        platform=DESKPET_PLATFORM,
        account_id=DESKPET_ACCOUNT_ID,
        scope=DESKPET_SCOPE,
        description="桌面宠物双向消息网关",
    )
    async def send_to_deskpet(
        self,
        message: Dict[str, Any],
        route: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """出站：将 MaiBot 生成的回复发送到桌宠前端。"""
        # 卸载开始后拒绝新的出站请求；_ws_server 可能在分块发送中途被清空，
        # 因此先取本地引用，后续只用它，不再二次读 self._ws_server
        server = self._ws_server
        if self._closing:
            return {"success": False, "error": "Plugin unloading"}
        if not server or not server.has_clients:
            return {"success": False, "error": "No deskpet client connected"}

        response_text = self._extract_text_from_message(message)
        media_items = self._extract_media_from_message(message)
        if not response_text and not media_items:
            self.ctx.logger.warning(f"[Deskpet] Empty extracted text and media, message keys: {list(message.keys())}")
            return {"success": True}

        req_id = uuid.uuid4().hex[:12]

        if response_text:
            recent_tool_emotion = time.time() - self._last_tool_emotion_at < TOOL_EMOTION_SUPPRESS_SECONDS
            if recent_tool_emotion:
                self.ctx.logger.debug("[Deskpet] Skip auto emotion because tool emotion was recently set")
            else:
                emotion = self._infer_emotion_from_text(response_text)
                if emotion not in ("neutral", "idle"):
                    self.ctx.logger.debug(f"[Deskpet] Auto inferred emotion: {emotion}")
                    await server.broadcast("state:emotion", {"emotion": emotion}, req_id)

            # 配置成 0/负数会让 range 步长非法，钳到至少 1
            buf = max(1, self.config.chat.stream_buffer_size)
            for i in range(0, len(response_text), buf):
                if self._closing:
                    # 分块发送中途开始卸载：立即停止，不再向已关闭的服务器推送
                    return {"success": False, "error": "Plugin unloading"}
                chunk = response_text[i:i + buf]
                await server.broadcast("output:text:delta", {"delta": chunk, "request_id": req_id})
                await asyncio.sleep(0.03)

            if self._closing:
                return {"success": False, "error": "Plugin unloading"}
            # 语音合成由桌宠端本地完成：这里只把「完整文本 + 是否朗读」交给客户端，
            # 客户端自行调用本机 TTS 桥并播放（避免服务器反向连接 NAT 后的客户端）。
            await server.broadcast("output:text:done", {
                "request_id": req_id,
                "text": response_text,
                "speak": bool(self.config.tts.enabled),
            })

        for item in media_items:
            if self._closing:
                return {"success": False, "error": "Plugin unloading"}
            await server.broadcast("output:emoji", {
                "base64": item["base64"],
                "description": item["description"],
                "emotion": item.get("emotion", ""),
            })

        return {"success": True}

    def _extract_media_from_message(self, message: Dict[str, Any]) -> list[Dict[str, str]]:
        """从 MaiBot 出站消息字典中提取表情包与图片组件（支持 binary_data_base64 与 Seg base64）。"""
        media_list: list[Dict[str, str]] = []
        raw_items: list[Dict[str, Any]] = []

        raw = message.get("raw_message")
        if isinstance(raw, list):
            raw_items.extend(item for item in raw if isinstance(item, dict))

        seg = message.get("message_segment")
        if isinstance(seg, dict):
            seg_type = str(seg.get("type") or "").strip().lower()
            if seg_type == "seglist" and isinstance(seg.get("data"), list):
                raw_items.extend(item for item in seg["data"] if isinstance(item, dict))
            elif seg_type in ("emoji", "image"):
                raw_items.append(seg)

        for comp in raw_items:
            comp_type = str(comp.get("type") or "").strip().lower()
            if comp_type not in ("emoji", "image"):
                continue
            b64 = str(comp.get("binary_data_base64") or "").strip()
            raw_data = str(comp.get("data") or "").strip()
            desc = str(comp.get("description") or "").strip()
            if not b64 and raw_data and not raw_data.startswith("["):
                b64 = raw_data
            if raw_data.startswith("[") and not desc:
                m = re.match(r"^\[(?:表情包|图片)(?:[：:]\s*([^\]]*))?\]$", raw_data)
                desc = (m.group(1).strip() if m and m.group(1) else "") or raw_data.strip("[]")
            if b64.startswith("data:") and "," in b64:
                b64 = b64.split(",", 1)[1].strip()
            if b64:
                media_list.append({
                    "base64": b64,
                    "description": desc,
                    "emotion": str(comp.get("emotion") or ""),
                })
        return media_list

    def _extract_text_from_message(self, message: Dict[str, Any]) -> str:
        """从 MaiBot 出站消息字典中提取纯文本。

        优先取 raw_message 的 text 组件：MaiBot 回复时会在 raw_message 头部插入一个
        reply 组件（引用被回复的消息），而 processed_plain_text 会把该引用内容与回复
        正文用空格拼接（形如「用户原文 回复正文」）。若直接采用 processed_plain_text，
        会把用户自己的输入当成回复内容回显给前端（旧实现即此问题）。
        """
        raw = message.get("raw_message")
        if isinstance(raw, list) and raw:
            texts = [
                str(comp.get("data", ""))
                for comp in raw
                if isinstance(comp, dict) and comp.get("type") == "text"
            ]
            # raw_message 存在即以其 text 组件为准：即使为空也不回退到
            # processed_plain_text，避免把引用内容当作正文回显。
            return clean_outbound_text(re.sub(r'^(?:@桌宠用户\s*)+', '', "".join(texts)))

        plain = message.get("processed_plain_text") or ""
        if plain:
            # 无 raw_message 时退回纯文本，尽力剥离可能的回复前缀与媒体占位标签
            cleaned = re.sub(r'^(?:\[回复[^\]]*\]\s*|@桌宠用户\s*)+', '', str(plain))
            return clean_outbound_text(cleaned)

        # Newer MaiBot replyer output may use different fields
        for key in ("content", "text", "response", "message"):
            val = message.get(key)
            if isinstance(val, str) and val.strip():
                return clean_outbound_text(val)
            if isinstance(val, list):
                parts = [str(item.get("text") or item.get("data") or "") for item in val if isinstance(item, dict)]
                result = "".join(parts)
                if result:
                    return clean_outbound_text(result)

        return ""

    def _infer_emotion_from_text(self, text: str) -> str:
        normalized = text.strip().lower()
        if not normalized:
            return "neutral"

        for p in getattr(self, "_model_presets", []) or []:
            pid = str(p.get("id") or "").strip().lower()
            label = str(p.get("label") or "").strip()
            if pid == "neutral" or label == "日常待机" or len(label) < 2:
                continue
            if label.lower() in normalized:
                return label

        for emotion, keywords in EMOTION_KEYWORDS.items():
            if any(keyword in normalized for keyword in keywords):
                return emotion

        return "neutral"

    # ── Client Messages (桌宠前端 → 插件) ──

    async def handle_client_message(self, msg: DeskpetMessage, ws=None) -> None:
        if msg.type == "input:text":
            await self._handle_input_text(msg)
        elif msg.type == "input:click":
            await self._handle_input_click(msg)
        elif msg.type == "input:screenshot":
            await self._handle_screenshot(msg)
        elif msg.type == "sys:emotions":
            # 模型（Live2D adapter / 立绘包清单）声明的自定义情绪键
            emotions = msg.data.get("emotions", [])
            if isinstance(emotions, list):
                self._model_emotions = {str(e) for e in emotions if isinstance(e, str) and e}
                self.ctx.logger.debug(f"[Deskpet] Model declared emotions: {sorted(self._model_emotions)}")
        elif msg.type == "sys:controls":
            # 模型声明或自动发现的控件开关清单（服饰/发型/道具/特效）+ 命名组合预设
            raw_controls = msg.data.get("controls", [])
            if isinstance(raw_controls, list):
                parsed: list[Dict[str, Any]] = []
                for item in raw_controls:
                    if not isinstance(item, dict):
                        continue
                    cid = str(item.get("id") or "").strip()
                    if not cid:
                        continue
                    parsed.append({
                        "id": cid,
                        "label": str(item.get("label") or cid).strip(),
                        "category": str(item.get("category") or "toggle").strip(),
                        "active": bool(item.get("active", False)),
                    })
                self._model_controls = parsed
                self.ctx.logger.debug(
                    f"[Deskpet] Model declared controls ({len(parsed)}): "
                    f"{[c['label'] for c in parsed]}"
                )
            raw_presets = msg.data.get("presets", [])
            if isinstance(raw_presets, list):
                parsed_presets: list[Dict[str, Any]] = []
                for item in raw_presets:
                    if not isinstance(item, dict):
                        continue
                    pid = str(item.get("id") or "").strip()
                    plabel = str(item.get("label") or pid).strip()
                    if not pid or not plabel:
                        continue
                    pcontrols = [
                        str(c).strip()
                        for c in (item.get("controls") or [])
                        if isinstance(c, str) and str(c).strip()
                    ]
                    raw_params = item.get("parameters")
                    pparams = raw_params if isinstance(raw_params, dict) else {}
                    pgroup = str(item.get("group") or "").strip()
                    parsed_presets.append({
                        "id": pid,
                        "label": plabel,
                        "group": pgroup,
                        "description": str(item.get("description") or "").strip(),
                        "emotion": str(item.get("emotion") or "neutral").strip() or "neutral",
                        "controls": pcontrols,
                        "parameters": pparams,
                        "custom": bool(item.get("custom", True)),
                    })
                self._model_presets = parsed_presets
                self.ctx.logger.debug(
                    f"[Deskpet] Model declared presets ({len(parsed_presets)}): "
                    f"{[p['label'] for p in parsed_presets]}"
                )
        elif msg.type == "heartbeat":
            # 回显心跳：前端靠“有没有入站消息”检测半开 TCP 连接
            if ws is not None:
                try:
                    await ws.send(DeskpetMessage(type="heartbeat").to_json())
                except websockets.ConnectionClosed:
                    pass

    async def _handle_input_text(self, msg: DeskpetMessage) -> None:
        text = msg.data.get("text", "").strip()
        if not text:
            return

        self.ctx.logger.debug(f"[Deskpet] User input: {text}")

        if not self._ws_server:
            return

        req_id = msg.request_id or uuid.uuid4().hex[:12]
        await self._ws_server.broadcast("state:thinking", {"request_id": req_id})

        message_id = f"deskpet-{uuid.uuid4().hex[:16]}"
        accepted = await self.ctx.gateway.route_message(
            gateway_name=self.GATEWAY_NAME,
            message={
                "message_id": message_id,
                "platform": self.DESKPET_PLATFORM,
                "account_id": self.DESKPET_ACCOUNT_ID,
                "scope": self.DESKPET_SCOPE,
                "timestamp": str(time.time()),
                "message_info": {
                    "user_info": {
                        "user_id": self.DESKPET_USER_ID,
                        "user_nickname": "桌宠用户",
                    },
                    "additional_config": {},
                },
                "raw_message": [
                    {"type": "text", "data": text},
                ],
            },
            external_message_id=message_id,
            dedupe_key=message_id,
        )

        if not accepted:
            self.ctx.logger.warning("[Deskpet] Host refused message injection")
            await self._ws_server.broadcast(
                "output:text:done",
                {"error": "Message rejected by MaiBot", "request_id": req_id},
            )

    async def _handle_input_click(self, msg: DeskpetMessage) -> None:
        reactions = ["嗯？", "怎么啦？", "别戳啦~", "有什么事吗？", "嘻嘻"]
        reaction = random.choice(reactions)
        if self._ws_server:
            await self._ws_server.broadcast("output:text", {"text": reaction})

    async def _handle_screenshot(self, msg: DeskpetMessage) -> None:
        image_b64 = msg.data.get("image", "")
        if not image_b64:
            return

        image_bytes = base64.b64decode(image_b64)
        image_hash = hashlib.sha256(image_bytes).hexdigest()
        self.ctx.logger.info(f"[Deskpet] Screenshot received ({len(image_bytes)} bytes, hash={image_hash[:12]})")

        message_id = f"deskpet-ss-{uuid.uuid4().hex[:16]}"
        await self.ctx.gateway.route_message(
            gateway_name=self.GATEWAY_NAME,
            message={
                "message_id": message_id,
                "platform": self.DESKPET_PLATFORM,
                "account_id": self.DESKPET_ACCOUNT_ID,
                "scope": self.DESKPET_SCOPE,
                "timestamp": str(time.time()),
                "message_info": {
                    "user_info": {
                        "user_id": self.DESKPET_USER_ID,
                        "user_nickname": "桌宠用户",
                    },
                    "additional_config": {},
                },
                "raw_message": [
                    {
                        "type": "image",
                        "data": "",
                        "hash": image_hash,
                        "binary_data_base64": image_b64,
                    },
                    {"type": "text", "data": "看看屏幕上有什么，简短评论一下"},
                ],
            },
            external_message_id=message_id,
            dedupe_key=message_id,
        )

    def _format_controls_summary(self) -> list[str]:
        controls = getattr(self, "_model_controls", []) or []
        return [
            f"{c['label']}({'on' if c.get('active') else 'off'})"
            for c in controls
        ]

    @staticmethod
    def _resolve_preset_group(preset: Dict[str, Any]) -> str:
        explicit = str(preset.get("group") or "").strip()
        if explicit:
            return explicit
        pid = str(preset.get("id") or "").strip().lower()
        label = str(preset.get("label") or "").strip()
        emo = str(preset.get("emotion") or "").strip().lower()
        prefix = label.split("·", 1)[0].strip() if "·" in label else ""

        if pid in ("neutral", "idle") or label == "日常待机":
            return "日常待机"
        if pid.startswith("annoyed") or prefix == "厌烦" or "厌烦" in label:
            return "厌烦"
        if pid.startswith("weary") or prefix == "倦怠" or "倦怠" in label:
            return "倦怠"
        if emo == "happy" or pid.startswith("happy") or prefix == "开心":
            return "开心"
        if emo == "shy" or pid.startswith("shy") or prefix == "害羞":
            return "害羞"
        if emo == "sad" or pid.startswith("sad") or prefix in ("委屈", "委屈难过"):
            return "委屈难过"
        if emo == "angry" or pid.startswith("angry") or prefix in ("生气", "生气不满"):
            return "生气不满"
        if emo == "embarrassed" or pid.startswith("embarrassed") or prefix == "尴尬":
            return "尴尬"
        if prefix:
            return prefix
        if emo and emo != "neutral":
            return emo
        return "日常待机"

    def _choose_random_group_preset(
        self, group_key: str, candidates: list[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]
        last_map = getattr(self, "_last_picked_preset_by_group", None)
        if not isinstance(last_map, dict):
            last_map = {}
            self._last_picked_preset_by_group = last_map
        last_id = last_map.get(group_key)
        pool = [p for p in candidates if p.get("id") != last_id] if last_id else candidates
        picked = random.choice(pool or candidates)
        last_map[group_key] = picked.get("id")
        return picked

    def _format_presets_summary(self) -> list[str]:
        presets = getattr(self, "_model_presets", []) or []
        summary: list[str] = []
        for p in presets:
            tag = "[自定义]" if p.get("custom") else ""
            grp = self._resolve_preset_group(p)
            desc = p.get("description") or (", ".join(p.get("controls") or []) or "默认")
            emo = p.get("emotion") or "neutral"
            summary.append(f"{p['label']}{tag}(分组:{grp}, {desc}, 情绪:{emo})")
        return summary

    def _match_model_preset(self, query: str) -> Optional[Dict[str, Any]]:
        presets = getattr(self, "_model_presets", []) or []
        q = (query or "").strip().lower()
        if not q:
            return None

        # 1) 当查询词对应某个拥有多个变体的情绪分组或基础情绪名时，在组内随机抽取一个变体（防连续重复）
        group_matches = [
            p
            for p in presets
            if self._resolve_preset_group(p).lower() == q
            or (q != "neutral" and str(p.get("emotion") or "").strip().lower() == q)
        ]
        if len(group_matches) > 1:
            return self._choose_random_group_preset(q, group_matches)

        # 2) 精确匹配单个预设的 id 或 label（如具体变体名 '开心·歪头笑'）
        for p in presets:
            if p["id"].lower() == q or p["label"].lower() == q:
                return p

        # 3) 单预设分组命中
        if len(group_matches) == 1:
            return group_matches[0]

        # 4) 模糊包含匹配（若命中同组多个变体同样随机抽取）
        fuzzy_matches = [
            p
            for p in presets
            if q in p["label"].lower()
            or p["label"].lower() in q
            or q == p["id"].lower()
            or q in self._resolve_preset_group(p).lower()
            or self._resolve_preset_group(p).lower() in q
        ]
        if len(fuzzy_matches) > 1:
            return self._choose_random_group_preset(q, fuzzy_matches)
        if len(fuzzy_matches) == 1:
            return fuzzy_matches[0]
        return None

    def _match_model_control(self, query: str) -> Optional[Dict[str, Any]]:
        controls = getattr(self, "_model_controls", []) or []
        q = (query or "").strip().lower()
        if not q:
            return None
        for c in controls:
            if c["id"].lower() == q or c["label"].lower() == q:
                return c
        for c in controls:
            cid = c["id"].lower()
            clabel = c["label"].lower()
            if q in cid or q in clabel or cid in q:
                return c
        return None

    # ── Tool: 表情与自定义状态预设 ──

    @Tool(
        "set_deskpet_emotion",
        brief_description="切换桌面宠物的情绪分组或用户在前端自定义的命名状态预设",
        detailed_description=(
            "切换桌面宠物当前的情绪分组或具体状态预设。可传入情绪分组名"
            "（如 '日常待机'、'开心'、'委屈难过'、'生气不满'、'厌烦'、'倦怠'、'尴尬'、'害羞' 等，同组有多个变体时会自动随机抽取一个）"
            "或具体变体名（如 '开心·歪头笑'），"
            f"或基础情绪词（{', '.join(EMOTION_LIST)}）。无需模型手动拼接底层控件，前端会自动还原预设对应的外观、配饰与面捕参数。"
        ),
        parameters=[
            ToolParameterInfo(
                name="emotion", param_type=ToolParamType.STRING,
                description="情绪分组名（如 '开心'、'害羞'、'生气不满'）、具体预设名或基础情绪名",
                required=True,
            ),
        ],
    )
    async def handle_set_emotion(self, emotion: str, controls: str = "", **kwargs) -> dict:
        valid = set(EMOTION_LIST) | getattr(self, "_model_emotions", set())
        matched_preset = self._match_model_preset(emotion)
        if emotion not in valid and not matched_preset:
            return {
                "success": False,
                "error": f"未知情绪或预设: {emotion}（当前可用: {', '.join(sorted(valid))}）",
                **({"available_presets": self._format_presets_summary()} if self._format_presets_summary() else {}),
            }
        if not self._ws_server or not self._ws_server.has_clients:
            return {"success": False, "error": "桌宠未连接，表情未生效"}

        resolved_emotion = matched_preset["label"] if matched_preset else emotion
        payload: Dict[str, Any] = {"emotion": resolved_emotion}
        matched_ids: list[str] = []

        if matched_preset and not (controls and controls.strip()):
            matched_ids = list(matched_preset.get("controls") or [])
            for c in getattr(self, "_model_controls", []) or []:
                c["active"] = c["id"] in matched_ids
        elif controls and controls.strip():
            preset_from_ctrl = self._match_model_preset(controls.strip())
            if preset_from_ctrl and "," not in controls and "，" not in controls:
                matched_ids = list(preset_from_ctrl.get("controls") or [])
                payload["controls"] = matched_ids
            else:
                parts = [p.strip() for p in controls.replace("，", ",").replace("；", ",").replace(";", ",").split(",") if p.strip()]
                for q in parts:
                    m = self._match_model_control(q)
                    if m and m["id"] not in matched_ids:
                        matched_ids.append(m["id"])
                if matched_ids:
                    payload["controls"] = matched_ids

        await self._ws_server.broadcast("state:emotion", payload)
        self._last_tool_emotion_at = time.time()
        res: Dict[str, Any] = {"success": True, "emotion": resolved_emotion}
        if matched_preset:
            res["applied_preset"] = matched_preset["label"]
        if matched_ids:
            res["applied_controls"] = matched_ids
        presets_summary = self._format_presets_summary()
        if presets_summary:
            res["available_presets"] = presets_summary
        controls_summary = self._format_controls_summary()
        if controls_summary:
            res["available_controls"] = controls_summary
        return res

    # ── Tool: 模型状态预设调用 ──

    @Tool(
        "set_deskpet_control",
        brief_description="查询或直接调用桌面宠物的命名状态/情绪预设",
        detailed_description=(
            "调用用户在桌面宠物前端配置好的『状态与情绪预设』（每个预设已打包好对应的服装发型、动作手势与面捕五官滑块参数）：\n"
            "1. 切换预设：传 action='preset'，control 填入预设名称（如 '厌烦'、'倦怠'、'尴尬'、'开心'、'日常待机' 或用户自定义的其它名称）。\n"
            "2. 查看可用预设：传 action='list' 获取当前模型的 available_presets 列表。\n"
            "3. 恢复默认：传 action='reset' 将所有状态恢复初始值。"
        ),
        parameters=[
            ToolParameterInfo(
                name="action", param_type=ToolParamType.STRING,
                description="操作类型: 'preset'（调用已命名的状态/情绪预设）、'list'（列出当前所有可用预设）、'reset'（恢复默认状态）",
                required=True,
            ),
            ToolParameterInfo(
                name="control", param_type=ToolParamType.STRING,
                description="状态/情绪预设名称（如 '厌烦'、'倦怠'、'尴尬'、'开心'）；action 为 'list' 或 'reset' 时留空",
                required=False,
            ),
        ],
    )
    async def handle_set_control(self, action: str = "toggle", control: str = "", emotion: str = "", **kwargs) -> dict:
        act = (action or "toggle").strip().lower()
        if act not in ("preset", "set", "on", "off", "toggle", "reset", "reset_transient", "list"):
            return {
                "success": False,
                "error": f"未知操作类型: {action}（可选: preset, set, on, off, toggle, reset, list）",
            }

        controls = getattr(self, "_model_controls", []) or []
        presets = getattr(self, "_model_presets", []) or []
        if act == "list":
            return {
                "success": True,
                "presets": presets,
                "available_presets": self._format_presets_summary(),
                "controls": controls,
                "available_controls": self._format_controls_summary(),
            }

        if not self._ws_server or not self._ws_server.has_clients:
            return {"success": False, "error": "桌宠未连接，控件未生效"}

        emo = (emotion or "").strip()
        if act in ("reset", "reset_transient"):
            payload: Dict[str, Any] = {"action": act, "control": ""}
            if emo:
                payload["emotion"] = emo
            await self._ws_server.broadcast("state:control", payload)
            for c in controls:
                if act == "reset" or c.get("category") not in ("outfit", "hair"):
                    c["active"] = False
            return {
                "success": True,
                "action": act,
                "available_presets": self._format_presets_summary(),
                "available_controls": self._format_controls_summary(),
            }

        raw_queries = [
            p.strip()
            for p in (control or "").replace("，", ",").replace("；", ",").replace(";", ",").split(",")
            if p.strip()
        ]

        # 优先检查是否匹配已命名的状态组合预设（action='preset' 或单个查询名命中预设）
        if len(raw_queries) == 1:
            preset_hit = self._match_model_preset(raw_queries[0])
            direct_control_hit = self._match_model_control(raw_queries[0])
            if preset_hit and (act == "preset" or act == "set" or not direct_control_hit):
                preset_controls = list(preset_hit.get("controls") or [])
                preset_emo = emo or str(preset_hit.get("emotion") or "neutral")
                ws_payload: Dict[str, Any] = {
                    "action": "preset",
                    "control": preset_hit["label"],
                    "controls": preset_controls,
                }
                if preset_emo:
                    ws_payload["emotion"] = preset_emo
                await self._ws_server.broadcast("state:control", ws_payload)
                self._last_tool_emotion_at = time.time()
                for c in controls:
                    c["active"] = c["id"] in preset_controls
                return {
                    "success": True,
                    "preset": preset_hit["label"],
                    "preset_id": preset_hit["id"],
                    "control": preset_hit["label"],
                    "controls": preset_controls,
                    "emotion": preset_emo,
                    "action": "preset",
                    "active": True,
                    "available_presets": self._format_presets_summary(),
                    "available_controls": self._format_controls_summary(),
                }

        if act == "preset":
            return {
                "success": False,
                "error": f"当前模型未找到名为 '{control}' 的状态组合预设",
                "available_presets": self._format_presets_summary(),
                "available_controls": self._format_controls_summary(),
            }

        if not raw_queries and act != "set":
            return {
                "success": False,
                "error": "请指定要操作的组合预设名或控件名，或使用 action='list' 查看可用预设与控件",
                "available_presets": self._format_presets_summary(),
                "available_controls": self._format_controls_summary(),
            }

        matched_list: list[Dict[str, Any]] = []
        unmatched_list: list[str] = []
        for q in raw_queries:
            m = self._match_model_control(q)
            if m:
                if m not in matched_list:
                    matched_list.append(m)
            else:
                unmatched_list.append(q)

        if raw_queries and not matched_list:
            return {
                "success": False,
                "error": f"当前模型未找到匹配 '{control}' 的预设或控件",
                "available_presets": self._format_presets_summary(),
                "available_controls": self._format_controls_summary(),
            }

        matched_ids = [m["id"] for m in matched_list]
        ws_payload = {
            "action": act,
            "control": ", ".join(matched_ids),
        }
        if len(matched_ids) > 1 or act == "set":
            ws_payload["controls"] = matched_ids
        if emo:
            ws_payload["emotion"] = emo

        await self._ws_server.broadcast("state:control", ws_payload)

        if act == "set":
            for c in controls:
                if c.get("category") not in ("outfit", "hair"):
                    c["active"] = False
            for m in matched_list:
                m["active"] = True
        else:
            for m in matched_list:
                if act == "on":
                    m["active"] = True
                elif act == "off":
                    m["active"] = False
                else:
                    m["active"] = not bool(m.get("active"))

        return {
            "success": True,
            "control": matched_ids[0] if len(matched_ids) == 1 else matched_ids,
            "controls": matched_ids,
            "label": ", ".join(m["label"] for m in matched_list),
            "action": act,
            "active": bool(matched_list[0].get("active")) if len(matched_list) == 1 else (act != "off"),
            **({"emotion": emo} if emo else {}),
            **({"unmatched": unmatched_list} if unmatched_list else {}),
            "available_presets": self._format_presets_summary(),
            "available_controls": self._format_controls_summary(),
        }

    # ── Tool: 动作 ──

    @Tool(
        "trigger_deskpet_animation",
        brief_description="触发桌面宠物的动作动画",
        detailed_description=f"让桌面宠物执行指定的动作。可选: {', '.join(ACTION_LIST)}。",
        parameters=[
            ToolParameterInfo(
                name="animation", param_type=ToolParamType.STRING,
                description=f"动作: {', '.join(ACTION_LIST)}", required=True,
            ),
            ToolParameterInfo(
                name="loop", param_type=ToolParamType.BOOLEAN,
                description="是否循环播放", required=False,
            ),
        ],
    )
    async def handle_animation(self, animation: str, loop: bool = False, **kwargs) -> dict:
        if animation not in ACTION_LIST:
            return {"success": False, "error": f"未知动作: {animation}"}
        if not self._ws_server or not self._ws_server.has_clients:
            return {"success": False, "error": "桌宠未连接，动作未生效"}
        await self._ws_server.broadcast("state:animation", {"name": animation, "loop": loop})
        return {"success": True, "animation": animation}

    # ── Tool: 表情包 ──

    @Tool(
        "send_deskpet_emoji",
        brief_description="发送表情包到桌面宠物",
        detailed_description="从麦麦的表情包库中搜索匹配的表情包图片，发送到桌面宠物显示。",
        parameters=[
            ToolParameterInfo(
                name="description", param_type=ToolParamType.STRING,
                description="表情包描述，例如'开心'、'无语'、'贴贴'、'猫猫'", required=True,
            ),
        ],
    )
    async def handle_send_emoji(self, description: str, **kwargs) -> dict:
        try:
            result = await self.ctx.emoji.get_by_description(description)
            # result 里带着 base64 图片数据，全量进日志会撑爆日志文件
            hit = result.get("emoji") if isinstance(result, dict) else None
            self.ctx.logger.info(
                f"[Deskpet] get_by_description('{description}') => "
                f"{'hit: ' + str(hit.get('description', '')) if hit else 'miss'}"
            )
        except Exception as e:
            self.ctx.logger.warning(f"[Deskpet] Emoji lookup failed: {e}")
            return {"success": False, "error": str(e)}

        emoji = result.get("emoji") if isinstance(result, dict) else None
        if not emoji:
            # fallback: random emoji
            try:
                rand_result = await self.ctx.emoji.get_random(count=1)
                emojis = rand_result.get("emojis", []) if isinstance(rand_result, dict) else []
                self.ctx.logger.info(f"[Deskpet] get_random fallback => {len(emojis)} emoji(s)")
                emoji = emojis[0] if emojis else None
            except Exception as e:
                self.ctx.logger.warning(f"[Deskpet] get_random failed: {e}")
        if not emoji:
            return {"success": True, "emoji": None, "message": "表情库为空，请先收集表情包"}

        if not self._ws_server or not self._ws_server.has_clients:
            return {"success": False, "error": "桌宠未连接，表情包未送达"}
        await self._ws_server.broadcast("output:emoji", {
            "base64": emoji.get("base64", ""),
            "description": emoji.get("description", ""),
            "emotion": emoji.get("emotion", ""),
        })
        return {"success": True, "emoji_sent": True, "description": emoji.get("description", "")}


def create_plugin() -> DeskpetPlugin:
    return DeskpetPlugin()

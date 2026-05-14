"""MaiBot Deskpet Plugin — 桌面宠物 Live2D 插件

将 MaiBot 的 AI 能力与 Live2D 桌面宠物应用桥接。
通过 MessageGateway 将桌宠输入注入 MaiBot 消息管线，由 Maisaka 推理引擎处理后返回回复。
WebSocket 服务器监听 ws://127.0.0.1:8523，供 Electron 前端连接。
"""

import asyncio
import json
import time
import uuid
import random
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
    config_version: str = Field(default="1.0.0", description="配置版本")


class WSServerConfig(PluginConfigBase):
    __ui_label__ = "WebSocket"
    __ui_icon__ = "wifi"
    __ui_order__ = 1
    host: str = Field(default="127.0.0.1", description="监听地址，跨设备时设为 0.0.0.0")
    port: int = Field(default=8523, description="监听端口")
    auth_token: str = Field(default="", description="鉴权令牌，留空则不验证")


class ChatConfig(PluginConfigBase):
    __ui_label__ = "对话"
    __ui_icon__ = "message-circle"
    __ui_order__ = 2
    stream_buffer_size: int = Field(default=50, description="流式文本每次推送的字符数")


class DeskpetPluginConfig(PluginConfigBase):
    plugin: PluginCoreConfig = Field(default_factory=PluginCoreConfig)
    ws_server: WSServerConfig = Field(default_factory=WSServerConfig)
    chat: ChatConfig = Field(default_factory=ChatConfig)


# ═══════════════════════════════════════════════
# Protocol
# ═══════════════════════════════════════════════

EMOTION_LIST = [
    "happy", "sad", "angry", "surprise",
    "thinking", "shy", "curious", "neutral", "idle"
]

ACTION_LIST = [
    "wave", "jump", "spin", "sit", "sleep", "wake", "dance", "cheer"
]


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

    async def start(self):
        self._server = await websockets.serve(
            self._handle_client, self.host, self.port, ping_interval=30, ping_timeout=10,
        )
        self.logger.info(f"[Deskpet] WebSocket server started on ws://{self.host}:{self.port}")

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self.logger.info("[Deskpet] WebSocket server stopped")

    async def broadcast(self, msg_type: str, data: dict, request_id: str = None):
        msg = DeskpetMessage(type=msg_type, data=data, request_id=request_id).to_json()
        disconnected = set()
        for client in self._clients:
            try:
                await client.send(msg)
            except websockets.ConnectionClosed:
                disconnected.add(client)
        self._clients -= disconnected

    @property
    def has_clients(self) -> bool:
        return len(self._clients) > 0

    async def _handle_client(self, ws: websockets.WebSocketServerProtocol):
        if self.auth_token:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                msg = DeskpetMessage.from_json(raw)
                if msg.type != "auth" or msg.data.get("token") != self.auth_token:
                    self.logger.warning(f"[Deskpet] Auth failed from {ws.remote_address}")
                    await ws.close(4001, "Unauthorized")
                    return
                self.logger.info(f"[Deskpet] Client authenticated: {ws.remote_address}")
            except asyncio.TimeoutError:
                self.logger.warning(f"[Deskpet] Auth timeout from {ws.remote_address}")
                await ws.close(4001, "Unauthorized")
                return

        self._clients.add(ws)
        addr = ws.remote_address
        self.logger.info(f"[Deskpet] Client connected: {addr}")
        try:
            async for raw in ws:
                try:
                    msg = DeskpetMessage.from_json(raw)
                    await self.plugin.handle_client_message(msg)
                except Exception as e:
                    self.logger.warning(f"[Deskpet] Bad message: {e}")
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(ws)
            self.logger.info(f"[Deskpet] Client disconnected: {addr}")


# ═══════════════════════════════════════════════
# Plugin
# ═══════════════════════════════════════════════

class DeskpetPlugin(MaiBotPlugin):
    config_model = DeskpetPluginConfig

    GATEWAY_NAME = "deskpet_gateway"
    DESKPET_USER_ID = "deskpet-user"

    async def on_load(self) -> None:
        self._ws_server: Optional[DeskpetWSServer] = None
        if not self.config.plugin.enabled:
            return

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
            platform="deskpet",
            scope="default",
        )
        self.ctx.logger.info("[Deskpet] Gateway ready, platform=deskpet")

    async def on_unload(self) -> None:
        await self.ctx.gateway.update_state(
            gateway_name=self.GATEWAY_NAME,
            ready=False,
        )
        if self._ws_server:
            await self._ws_server.stop()
            self._ws_server = None

    async def on_config_update(self, scope: str, config_data: dict, version: str) -> None:
        self.ctx.logger.info(f"[Deskpet] Config updated: scope={scope}, version={version}")

    # ── MessageGateway: 出站 (MaiBot → 桌宠) ──

    @MessageGateway(
        route_type="duplex",
        name=GATEWAY_NAME,
        platform="deskpet",
        description="桌面宠物双向消息网关",
    )
    async def send_to_deskpet(
        self,
        message: Dict[str, Any],
        route: Dict[str, Any] | None = None,
        metadata: Dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """出站：将 MaiBot 生成的回复发送到桌宠前端。"""
        if not self._ws_server or not self._ws_server.has_clients:
            return {"success": False, "error": "No deskpet client connected"}

        response_text = self._extract_text_from_message(message)
        if not response_text:
            return {"success": True}

        req_id = uuid.uuid4().hex[:12]
        buf = self.config.chat.stream_buffer_size
        for i in range(0, len(response_text), buf):
            chunk = response_text[i:i + buf]
            await self._ws_server.broadcast("output:text:delta", {"delta": chunk, "request_id": req_id})
            await asyncio.sleep(0.03)

        await self._ws_server.broadcast("output:text:done", {"request_id": req_id})
        return {"success": True}

    def _extract_text_from_message(self, message: Dict[str, Any]) -> str:
        """从 MaiBot 出站消息字典中提取纯文本。"""
        plain = message.get("processed_plain_text", "")
        if plain:
            return str(plain)

        raw = message.get("raw_message", [])
        if isinstance(raw, list):
            texts = [
                str(comp.get("data", ""))
                for comp in raw
                if isinstance(comp, dict) and comp.get("type") == "text"
            ]
            return "".join(texts)

        return ""

    # ── Client Messages (桌宠前端 → 插件) ──

    async def handle_client_message(self, msg: DeskpetMessage) -> None:
        if msg.type == "input:text":
            await self._handle_input_text(msg)
        elif msg.type == "input:click":
            await self._handle_input_click(msg)
        elif msg.type == "heartbeat":
            pass  # silently ack

    async def _handle_input_text(self, msg: DeskpetMessage) -> None:
        text = msg.data.get("text", "").strip()
        if not text:
            return

        self.ctx.logger.info(f"[Deskpet] User input: {text}")

        if not self._ws_server:
            return

        req_id = msg.request_id or uuid.uuid4().hex[:12]
        await self._ws_server.broadcast("state:thinking", {"request_id": req_id})

        message_id = f"deskpet-{uuid.uuid4().hex[:16]}"
        accepted = await self.ctx.gateway.route_message(
            gateway_name=self.GATEWAY_NAME,
            message={
                "message_id": message_id,
                "platform": "deskpet",
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

    # ── Tool: 表情 ──

    @Tool(
        "set_deskpet_emotion",
        brief_description="设置桌面宠物的情绪/表情",
        detailed_description=f"控制桌面宠物 Live2D 角色表现的情绪。可选值: {', '.join(EMOTION_LIST)}。",
        parameters=[
            ToolParameterInfo(
                name="emotion", param_type=ToolParamType.STRING,
                description=f"情绪: {', '.join(EMOTION_LIST)}", required=True,
            ),
        ],
    )
    async def handle_set_emotion(self, emotion: str, **kwargs) -> dict:
        if emotion not in EMOTION_LIST:
            return {"success": False, "error": f"未知情绪: {emotion}"}
        if self._ws_server:
            await self._ws_server.broadcast("state:emotion", {"emotion": emotion})
        return {"success": True, "emotion": emotion}

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
        if self._ws_server:
            await self._ws_server.broadcast("state:animation", {"name": animation, "loop": loop})
        return {"success": True, "animation": animation}

    # ── Tool: 气泡 ──

    @Tool(
        "send_deskpet_bubble",
        brief_description="在桌面宠物上显示文本气泡",
        detailed_description="在 Live2D 桌面宠物上方显示指定文本的对话气泡。",
        parameters=[
            ToolParameterInfo(
                name="text", param_type=ToolParamType.STRING,
                description="要显示在气泡中的文本", required=True,
            ),
        ],
    )
    async def handle_send_bubble(self, text: str, **kwargs) -> dict:
        if self._ws_server:
            await self._ws_server.broadcast("output:text", {"text": text})
        return {"success": True, "text": text}


def create_plugin() -> DeskpetPlugin:
    return DeskpetPlugin()

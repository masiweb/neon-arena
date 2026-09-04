from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .game import GameHub


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
ROOM_RE = re.compile(r"^[A-HJ-NP-Z2-9]{4}$")

app = FastAPI(title="Neon Arena", docs_url=None, redoc_url=None)
hub = GameHub()
GAME_VERSION = "1.7.0"
PROTOCOL_VERSION = "4"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", "https://game.chanelchat.ir"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def clean_name(raw: str) -> str:
    name = " ".join(raw.strip().split())[:18]
    return name or "بازیکن"


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "version": GAME_VERSION, "protocol": PROTOCOL_VERSION, **hub.stats()}


@app.post("/api/rooms")
async def create_room() -> dict[str, str]:
    room = hub.create_room()
    return {"code": room.code}


@app.get("/api/rooms/{code}")
async def room_info(code: str) -> dict[str, object]:
    normalized = code.upper()
    if not ROOM_RE.fullmatch(normalized):
        raise HTTPException(status_code=404, detail="اتاق پیدا نشد")
    room = hub.get_room(normalized)
    if not room:
        raise HTTPException(status_code=404, detail="اتاق پیدا نشد")
    return {"code": room.code, "players": len(room.players), "phase": room.phase}


@app.websocket("/ws/{code}")
async def game_socket(socket: WebSocket, code: str) -> None:
    normalized = code.upper()
    await socket.accept()
    client_protocol = socket.query_params.get("protocol")
    if client_protocol and client_protocol != PROTOCOL_VERSION:
        await socket.send_json({"type": "error", "message": "نسخه بازی قدیمی است؛ برنامه را به‌روزرسانی کنید"})
        await socket.close(code=1008)
        return
    if not ROOM_RE.fullmatch(normalized):
        await socket.send_json({"type": "error", "message": "کد اتاق نامعتبر است"})
        await socket.close(code=1008)
        return
    room = hub.get_room(normalized)
    if not room:
        await socket.send_json({"type": "error", "message": "این اتاق وجود ندارد"})
        await socket.close(code=1008)
        return

    player = None
    try:
        player = await room.add_player(socket, clean_name(socket.query_params.get("name", "")))
        while True:
            raw = await socket.receive_text()
            if len(raw) > 1_500:
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                await room.handle(player, payload)
    except ValueError as exc:
        await socket.send_json({"type": "error", "message": str(exc)})
        await socket.close(code=1013)
    except WebSocketDisconnect:
        pass
    finally:
        if player:
            await room.remove_player(player.id)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

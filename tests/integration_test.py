"""Small live HTTP/WebSocket smoke test for a running local server."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import urllib.request
import uuid

import websockets

from server.main import GAME_VERSION, PROTOCOL_VERSION, database

BASE_HTTP = os.environ.get("NEON_TEST_HTTP", "http://127.0.0.1:8766").rstrip("/")
BASE_WS = os.environ.get("NEON_TEST_WS", "ws://127.0.0.1:8766").rstrip("/")


async def receive_type(socket, wanted: str, timeout: float = 7.0) -> dict:
    async with asyncio.timeout(timeout):
        while True:
            payload = json.loads(await socket.recv())
            if payload.get("type") == wanted:
                return payload


def http_json(method: str, path: str, body: dict | None = None, token: str = "") -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"{BASE_HTTP}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=7) as response:
        return json.loads(response.read().decode("utf-8"))


async def main() -> None:
    health = await asyncio.to_thread(http_json, "GET", "/health")
    assert health["ok"] is True
    assert health["version"] == GAME_VERSION
    assert health["protocol"] == PROTOCOL_VERSION
    unique = uuid.uuid4().hex[:10]
    one = await asyncio.to_thread(http_json, "POST", "/api/auth/register", {"email":f"one-{unique}@example.com","username":f"one_{unique}","password":"Password123","referralCode":""})
    two = await asyncio.to_thread(http_json, "POST", "/api/auth/register", {"email":f"two-{unique}@example.com","username":f"two_{unique}","password":"Password123","referralCode":one["user"]["referralCode"]})
    await asyncio.to_thread(database.promote_admin, f"one-{unique}@example.com")
    me = await asyncio.to_thread(http_json, "GET", "/api/me", None, one["token"])
    assert me["user"]["gold"] == 350
    assert me["user"]["isAdmin"] is True
    admin_stats = await asyncio.to_thread(http_json, "GET", "/api/admin/stats", None, one["token"])
    assert admin_stats["users"] == 2
    ad = await asyncio.to_thread(http_json, "POST", "/api/admin/ads", {"title":"Integration ad","body":"visible","imageUrl":"","targetUrl":"","placement":"lobby","active":True,"startsAt":None,"endsAt":None,"sortOrder":0}, one["token"])
    assert ad["ad"]["title"] == "Integration ad"
    audit = await asyncio.to_thread(http_json, "GET", "/api/admin/audit", None, one["token"])
    assert audit["logs"]
    team = await asyncio.to_thread(http_json, "POST", "/api/teams", {"name":"Integration Six"}, one["token"])
    await asyncio.to_thread(http_json, "POST", "/api/teams/join", {"inviteCode":team["team"]["inviteCode"]}, two["token"])
    room = await asyncio.to_thread(http_json, "POST", "/api/rooms", None, one["token"])
    code = room["code"]
    same_room = await asyncio.to_thread(http_json, "POST", "/api/rooms", None, one["token"])
    assert same_room["code"] == code and same_room["reused"] is True

    async with (
        websockets.connect(f"{BASE_WS}/ws/{code}?protocol={PROTOCOL_VERSION}&client=android", proxy=None) as first,
        websockets.connect(f"{BASE_WS}/ws/{code}?protocol={PROTOCOL_VERSION}&client=web", proxy=None) as second,
    ):
        await first.send(json.dumps({"type":"auth","token":one["token"]}))
        await second.send(json.dumps({"type":"auth","token":two["token"]}))
        welcome_one = await receive_type(first, "welcome")
        welcome_two = await receive_type(second, "welcome")
        assert welcome_one["room"] == code == welcome_two["room"]
        assert len(welcome_one["maps"]) == 6
        assert welcome_one["accountId"] == one["user"]["id"]
        assert welcome_one["teamId"] == welcome_two["teamId"]
        assert welcome_one["ownerUserId"] == one["user"]["id"]
        assert {level["id"] for level in welcome_one["botDifficulties"]} == {"easy", "normal", "hard"}
        await first.send(json.dumps({"type": "select_map", "map": "reactor"}))
        arena_update = await receive_type(first, "arena")
        assert arena_update["arena"]["id"] == "reactor"
        assert arena_update["arena"]["width"] == 3600
        await first.send(json.dumps({"type": "set_bot_difficulty", "difficulty": "hard"}))
        await first.send(json.dumps({"type": "add_bot"}))
        bot_state = None
        async with asyncio.timeout(7.0):
            while bot_state is None:
                candidate = await receive_type(first, "state")
                if candidate["mapId"] == "reactor" and candidate["botDifficulty"] == "hard" and any(player.get("bot") for player in candidate["players"]):
                    bot_state = candidate
        assert sum(1 for player in bot_state["players"] if player["bot"]) == 1
        await first.send(json.dumps({"type": "start"}))

        playing = None
        async with asyncio.timeout(7.0):
            while playing is None:
                state = await receive_type(first, "state")
                if state["phase"] == "playing":
                    playing = state
        assert len(playing["players"]) == 3
        assert all(player["lives"] == 3 for player in playing["players"])
        assert "powerups" in playing

        me_before = next(player for player in playing["players"] if player["id"] == welcome_one["playerId"])
        await first.send(json.dumps({"type": "action", "action": "jump"}))
        jumping_me = None
        async with asyncio.timeout(3.0):
            while jumping_me is None or jumping_me["z"] <= 0:
                jumping = await receive_type(first, "state")
                jumping_me = next(player for player in jumping["players"] if player["id"] == welcome_one["playerId"])
        assert jumping_me["z"] > 0
        await first.send(json.dumps({"type": "input", "seq": 1, "move": [1, 0], "aim": [1, 0], "shooting": True}))
        moved = None
        me_after = None
        async with asyncio.timeout(3.0):
            while moved is None or me_after is None or me_after["ack"] < 1 or not moved["bullets"]:
                moved = await receive_type(first, "state")
                me_after = next(player for player in moved["players"] if player["id"] == welcome_one["playerId"])
        assert me_after["x"] >= me_before["x"]
        assert me_after["ack"] == 1
        assert moved["bullets"]

        powerup_state = moved
        async with asyncio.timeout(6.0):
            while not powerup_state["powerups"]:
                powerup_state = await receive_type(first, "state")
        assert powerup_state["powerups"][0]["kind"] in {"speed", "health", "shield", "weapon", "stealth", "grenade", "rpg"}
        assert "projectiles" in powerup_state and "explosions" in powerup_state
        await first.send(json.dumps({"type":"reset"}))
        reset_state = await receive_type(first, "state")
        assert reset_state["phase"] in {"countdown", "playing"}

    print("integration test: OK")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"integration test: FAILED: {exc}", file=sys.stderr)
        raise

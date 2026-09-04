"""Small live HTTP/WebSocket smoke test for a running local server."""

from __future__ import annotations

import asyncio
import json
import sys

import httpx
import websockets


BASE_HTTP = "http://127.0.0.1:8766"
BASE_WS = "ws://127.0.0.1:8766"


async def receive_type(socket, wanted: str, timeout: float = 7.0) -> dict:
    async with asyncio.timeout(timeout):
        while True:
            payload = json.loads(await socket.recv())
            if payload.get("type") == wanted:
                return payload


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE_HTTP, trust_env=False) as client:
        health = (await client.get("/health")).json()
        assert health["ok"] is True
        assert health["version"] == "1.8.0"
        assert health["protocol"] == "4"
        response = await client.post("/api/rooms")
        response.raise_for_status()
        code = response.json()["code"]

    async with (
        websockets.connect(f"{BASE_WS}/ws/{code}?name=One&protocol=4&client=android", proxy=None) as first,
        websockets.connect(f"{BASE_WS}/ws/{code}?name=Two&protocol=4&client=web", proxy=None) as second,
    ):
        welcome_one = await receive_type(first, "welcome")
        welcome_two = await receive_type(second, "welcome")
        assert welcome_one["room"] == code == welcome_two["room"]
        await first.send(json.dumps({"type": "add_bot"}))
        bot_state = None
        async with asyncio.timeout(7.0):
            while bot_state is None:
                candidate = await receive_type(first, "state")
                if any(player.get("bot") for player in candidate["players"]):
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
        await first.send(json.dumps({"type": "input", "seq": 1, "move": [1, 0], "aim": [1, 0], "shooting": True}))
        await asyncio.sleep(0.35)
        moved = await receive_type(first, "state")
        me_after = next(player for player in moved["players"] if player["id"] == welcome_one["playerId"])
        assert me_after["x"] >= me_before["x"]
        assert me_after["ack"] == 1
        assert moved["bullets"]

        powerup_state = moved
        async with asyncio.timeout(6.0):
            while not powerup_state["powerups"]:
                powerup_state = await receive_type(first, "state")
        assert powerup_state["powerups"][0]["kind"] in {"speed", "health", "shield", "weapon", "stealth"}

    print("integration test: OK")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"integration test: FAILED: {exc}", file=sys.stderr)
        raise

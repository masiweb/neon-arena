from __future__ import annotations

import asyncio
import math
import random
import secrets
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

from .maps import DEFAULT_MAP_ID, MAPS, map_options, public_map

if TYPE_CHECKING:
    from fastapi import WebSocket
else:
    WebSocket = Any


ARENA_WIDTH = int(MAPS[DEFAULT_MAP_ID]["width"])
ARENA_HEIGHT = int(MAPS[DEFAULT_MAP_ID]["height"])
PLAYER_RADIUS = 21
PLAYER_HEIGHT = 72
PLAYER_SPEED = 285.0
BULLET_SPEED = 650.0
JUMP_VELOCITY = 430.0
GRAVITY = 920.0
STEP_CLEARANCE = 7.0
ROUND_SECONDS = 120
STARTING_LIVES = 3
MAX_HEALTH = 140
MAX_PLAYERS = 12
POWERUP_FIRST_DELAY = 3.5
POWERUP_SPAWN_MIN = 3.5
POWERUP_SPAWN_MAX = 5.5
POWERUP_TTL = 13.0
MAX_POWERUPS = 8
GRENADE_SPEED = 470.0
GRENADE_LIFT = 360.0
GRENADE_FUSE = 1.65
RPG_SPEED = 610.0
PROJECTILE_RADIUS = 8.0

COLORS = [
    "#20d9ff",
    "#ff2da6",
    "#9dff24",
    "#ff8b23",
    "#9b66ff",
    "#ffd52a",
    "#2cffc5",
    "#ff5e63",
    "#45a6ff",
    "#f875ff",
    "#b9ff4a",
    "#ffb85a",
]

# Backward-compatible aliases used by tests and utility callers. Each room uses
# its own selected map at runtime.
OBSTACLES = MAPS[DEFAULT_MAP_ID]["obstacles"]

POWERUP_LABELS = {
    "speed": "افزایش سرعت",
    "health": "خون اضافه",
    "shield": "سپر دفاعی",
    "weapon": "سلاح قوی‌تر",
    "stealth": "اختفای نقشه",
    "grenade": "۳ نارنجک",
    "rpg": "۳ موشک RPG",
}

WEAPON_SPECS: dict[str, dict[str, Any]] = {
    "base": {"interval": 0.22, "damage": 10, "range": 920.0, "spread": [0.0]},
    "heavy": {"interval": 0.46, "damage": 25, "range": 1050.0, "spread": [0.0]},
    "rapid": {"interval": 0.105, "damage": 7, "range": 820.0, "spread": [-0.015, 0.015]},
    "spread": {"interval": 0.39, "damage": 9, "range": 620.0, "spread": [-0.09, 0.0, 0.09]},
}

BOT_DIFFICULTIES: dict[str, dict[str, Any]] = {
    "easy": {"name": "آسان", "aim_error": 0.24, "range": 520.0, "speed": 0.78, "fire_delay": 1.55},
    "normal": {"name": "معمولی", "aim_error": 0.085, "range": 760.0, "speed": 0.96, "fire_delay": 1.12},
    "hard": {"name": "سخت", "aim_error": 0.025, "range": 980.0, "speed": 1.1, "fire_delay": 0.88},
}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize(x: float, y: float) -> tuple[float, float]:
    length = math.hypot(x, y)
    if length < 0.001 or not math.isfinite(length):
        return 0.0, 0.0
    return x / length, y / length


def movement_vector(x: float, y: float) -> tuple[float, float]:
    """Preserve joystick intensity while clamping impossible input values."""
    length = math.hypot(x, y)
    if length < 0.06 or not math.isfinite(length):
        return 0.0, 0.0
    if length <= 1.0:
        return x, y
    return x / length, y / length


def circle_hits_rect(x: float, y: float, radius: float, rect: dict[str, int]) -> bool:
    nearest_x = clamp(x, rect["x"], rect["x"] + rect["w"])
    nearest_y = clamp(y, rect["y"], rect["y"] + rect["h"])
    return (x - nearest_x) ** 2 + (y - nearest_y) ** 2 < radius**2


def ray_rect_distance(
    origin_x: float,
    origin_y: float,
    direction_x: float,
    direction_y: float,
    rect: dict[str, int],
    max_distance: float,
) -> float | None:
    """Return the first ray/rectangle intersection distance, if any."""
    near, far = 0.0, max_distance
    for origin, direction, low, high in (
        (origin_x, direction_x, rect["x"], rect["x"] + rect["w"]),
        (origin_y, direction_y, rect["y"], rect["y"] + rect["h"]),
    ):
        if abs(direction) < 1e-9:
            if origin < low or origin > high:
                return None
            continue
        first, second = (low - origin) / direction, (high - origin) / direction
        if first > second:
            first, second = second, first
        near, far = max(near, first), min(far, second)
        if near > far:
            return None
    return near if 0.0 <= near <= max_distance else None


def clear_position(
    x: float,
    y: float,
    radius: float = PLAYER_RADIUS,
    arena: dict[str, Any] | None = None,
    z: float = 0.0,
) -> bool:
    selected = arena or MAPS[DEFAULT_MAP_ID]
    width, height = float(selected["width"]), float(selected["height"])
    if x < radius or x > width - radius or y < radius or y > height - radius:
        return False
    return not any(
        float(obstacle.get("height", 100)) > z + STEP_CLEARANCE
        and circle_hits_rect(x, y, radius, obstacle)
        for obstacle in selected["obstacles"]
    )


def surface_height(x: float, y: float, arena: dict[str, Any] | None = None) -> float:
    selected = arena or MAPS[DEFAULT_MAP_ID]
    return max(
        (
            float(obstacle.get("height", 100))
            for obstacle in selected["obstacles"]
            if obstacle["x"] <= x <= obstacle["x"] + obstacle["w"]
            and obstacle["y"] <= y <= obstacle["y"] + obstacle["h"]
        ),
        default=0.0,
    )


def spawn_point(players: list["Player"], arena: dict[str, Any] | None = None) -> tuple[float, float]:
    selected = arena or MAPS[DEFAULT_MAP_ID]
    width, height = float(selected["width"]), float(selected["height"])
    for _ in range(80):
        x = random.uniform(65, width - 65)
        y = random.uniform(65, height - 65)
        if clear_position(x, y, arena=selected) and all(
            math.hypot(x - player.x, y - player.y) > 120 for player in players if player.alive
        ):
            return x, y
    return 80.0, 80.0


def item_spawn_point(
    players: list["Player"],
    items: list["PowerUp"],
    arena: dict[str, Any] | None = None,
) -> tuple[float, float]:
    selected = arena or MAPS[DEFAULT_MAP_ID]
    width, height = float(selected["width"]), float(selected["height"])
    for _ in range(80):
        x = random.uniform(55, width - 55)
        y = random.uniform(55, height - 55)
        if not clear_position(x, y, 24, selected):
            continue
        if any(math.hypot(x - item.x, y - item.y) < 90 for item in items):
            continue
        if any(math.hypot(x - player.x, y - player.y) < 70 for player in players if player.alive):
            continue
        return x, y
    return width / 2, height / 2


@dataclass(slots=True)
class Player:
    id: str
    name: str
    color: str
    socket: WebSocket
    x: float
    y: float
    account_id: int | None = None
    team_id: int | None = None
    z: float = 0.0
    velocity_z: float = 0.0
    grounded: bool = True
    health: int = 100
    lives: int = STARTING_LIVES
    score: int = 0
    alive: bool = True
    move_x: float = 0.0
    move_y: float = 0.0
    aim_x: float = 1.0
    aim_y: float = 0.0
    shooting: bool = False
    last_input_seq: int = 0
    last_input_at: float = field(default_factory=time.monotonic)
    last_shot: float = 0.0
    dash_until: float = 0.0
    dash_ready_at: float = 0.0
    speed_until: float = 0.0
    shield_until: float = 0.0
    shield_ready_at: float = 0.0
    respawn_at: float = 0.0
    base_weapon: str = "base"
    weapon: str = "base"
    weapon_until: float = 0.0
    radar_hidden_until: float = 0.0
    grenades: int = 0
    rockets: int = 0
    last_explosive_at: float = 0.0
    round_kills: int = 0
    voice_mode: str | None = None
    reward_weapon: str | None = None
    is_bot: bool = False
    bot_dash_at: float = 0.0
    bot_shield_at: float = 0.0
    bot_jump_at: float = 0.0
    joined_at: float = field(default_factory=time.monotonic)

    def public(self, now: float) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "z": round(self.z, 1),
            "vz": round(self.velocity_z, 1),
            "health": self.health,
            "lives": self.lives,
            "score": self.score,
            "alive": self.alive,
            "aim": [round(self.aim_x, 2), round(self.aim_y, 2)],
            "shield": self.shield_until > now,
            "speedBoost": self.speed_until > now,
            "dashing": self.dash_until > now,
            "weapon": self.weapon,
            "radarHidden": self.radar_hidden_until > now,
            "bot": self.is_bot,
            "accountId": self.account_id,
            "teamId": self.team_id,
            "grenades": self.grenades,
            "rockets": self.rockets,
            "voiceMode": self.voice_mode,
            "ack": self.last_input_seq,
            "dashCooldown": round(max(0.0, self.dash_ready_at - now), 1),
            "shieldCooldown": round(max(0.0, self.shield_ready_at - now), 1),
            "grounded": self.grounded,
        }


@dataclass(slots=True)
class Bullet:
    id: str
    owner_id: str
    x1: float
    y1: float
    x2: float
    y2: float
    z: float
    color: str
    expires_at: float
    hit: bool = False

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "owner": self.owner_id,
            "x1": round(self.x1, 1),
            "y1": round(self.y1, 1),
            "x2": round(self.x2, 1),
            "y2": round(self.y2, 1),
            "z": round(self.z, 1),
            "color": self.color,
            "hit": self.hit,
        }


@dataclass(slots=True)
class PowerUp:
    id: str
    kind: str
    x: float
    y: float
    expires_at: float

    def public(self, now: float) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "remaining": round(max(0.0, self.expires_at - now), 1),
        }


@dataclass(slots=True)
class Projectile:
    id: str
    owner_id: str
    kind: str
    x: float
    y: float
    z: float
    vx: float
    vy: float
    vz: float
    explodes_at: float

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "owner": self.owner_id,
            "kind": self.kind,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "z": round(self.z, 1),
            "vx": round(self.vx, 1),
            "vy": round(self.vy, 1),
            "vz": round(self.vz, 1),
        }


@dataclass(slots=True)
class Explosion:
    id: str
    kind: str
    x: float
    y: float
    z: float
    radius: float
    expires_at: float

    def public(self, now: float) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "z": round(self.z, 1),
            "radius": round(self.radius, 1),
            "remaining": round(max(0.0, self.expires_at - now), 2),
        }


class Room:
    def __init__(
        self,
        code: str,
        owner_user_id: int | None = None,
        match_recorder: Callable[[str, str, str, list[dict[str, Any]]], None] | None = None,
    ) -> None:
        self.code = code
        self.owner_user_id = owner_user_id
        self.match_recorder = match_recorder
        self.map_id = DEFAULT_MAP_ID
        self.bot_difficulty = "normal"
        self.players: dict[str, Player] = {}
        self.bullets: list[Bullet] = []
        self.powerups: list[PowerUp] = []
        self.projectiles: list[Projectile] = []
        self.explosions: list[Explosion] = []
        self.host_id: str | None = None
        self.phase = "lobby"
        self.countdown_until = 0.0
        self.round_ends_at = 0.0
        self.return_to_lobby_at = 0.0
        self.next_powerup_at = 0.0
        self.round_size = 0
        self.winner_id: str | None = None
        self.winner_name = ""
        self.winner_choice = ""
        self.round_id = ""
        self.round_accounts: dict[int, str] = {}
        self.round_kills: dict[int, int] = {}
        self.match_recorded = False
        self.task: asyncio.Task[None] | None = None
        self.closed = False

    @property
    def arena(self) -> dict[str, Any]:
        return MAPS[self.map_id]

    def arena_public(self) -> dict[str, Any]:
        return public_map(self.map_id)

    def start_loop(self) -> None:
        if not self.task or self.task.done():
            self.task = asyncio.create_task(self._loop())

    async def add_player(
        self,
        socket: WebSocket,
        account: dict[str, Any],
        ice_servers: list[dict[str, Any]] | None = None,
    ) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("این اتاق پر است")
        account_id = int(account["id"])
        if any(member.account_id == account_id for member in self.players.values()):
            raise ValueError("این حساب قبلاً وارد اتاق شده است")
        player_id = secrets.token_urlsafe(8)
        used_colors = {player.color for player in self.players.values()}
        color = next((item for item in COLORS if item not in used_colors), random.choice(COLORS))
        x, y = spawn_point(list(self.players.values()), self.arena)
        team = account.get("team") or {}
        player = Player(
            player_id,
            str(account["username"]),
            color,
            socket,
            x,
            y,
            account_id=account_id,
            team_id=int(team["id"]) if team.get("id") is not None else None,
        )
        self.players[player_id] = player
        if self.owner_user_id == account_id or (self.owner_user_id is None and self.host_id is None):
            self.host_id = player_id
        if self.phase in {"countdown", "playing"}:
            self.round_accounts[account_id] = player.name
            self.round_kills.setdefault(account_id, 0)
            player.round_kills = 0
        self.start_loop()
        await socket.send_json(
            {
                "type": "welcome",
                "playerId": player_id,
                "room": self.code,
                "hostId": self.host_id,
                "ownerUserId": self.owner_user_id,
                "accountId": account_id,
                "teamId": player.team_id,
                "arena": self.arena_public(),
                "maps": map_options(),
                "botDifficulties": [
                    {"id": level_id, "name": config["name"]}
                    for level_id, config in BOT_DIFFICULTIES.items()
                ],
                "iceServers": ice_servers or [],
            }
        )
        await self.broadcast_event("join", f"{player.name} وارد بازی شد")
        return player

    async def add_bot(self) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("این اتاق پر است")
        bot_number = 1 + sum(player.is_bot for player in self.players.values())
        player_id = f"bot-{secrets.token_hex(4)}"
        used_colors = {player.color for player in self.players.values()}
        color = next((item for item in COLORS if item not in used_colors), random.choice(COLORS))
        x, y = spawn_point(list(self.players.values()), self.arena)
        bot = Player(player_id, f"بات {bot_number}", color, None, x, y, is_bot=True)
        bot.bot_dash_at = time.monotonic() + random.uniform(2.0, 5.0)
        bot.bot_shield_at = time.monotonic() + random.uniform(3.0, 6.0)
        bot.bot_jump_at = time.monotonic() + random.uniform(1.5, 4.0)
        self.players[player_id] = bot
        self.start_loop()
        await self.broadcast_event("bot_join", f"{bot.name} اضافه شد")
        return bot

    async def remove_bot(self) -> bool:
        bot = next((player for player in reversed(list(self.players.values())) if player.is_bot), None)
        if not bot:
            return False
        self.players.pop(bot.id, None)
        self.bullets = [bullet for bullet in self.bullets if bullet.owner_id != bot.id]
        await self.broadcast_event("bot_leave", f"{bot.name} حذف شد")
        return True

    async def remove_player(self, player_id: str) -> None:
        player = self.players.pop(player_id, None)
        if not player:
            return
        self.bullets = [bullet for bullet in self.bullets if bullet.owner_id != player_id]
        if self.host_id == player_id:
            self.host_id = (
                None
                if self.owner_user_id is not None
                else next((item.id for item in self.players.values() if not item.is_bot), None)
            )
        if self.winner_id == player_id and not self.winner_choice:
            self.winner_choice = "base"
        await self.broadcast_event("leave", f"{player.name} از بازی خارج شد")
        await self._broadcast_voice_peers()

    async def remove_account(self, account_id: int) -> None:
        player = next((item for item in self.players.values() if item.account_id == account_id), None)
        if not player:
            return
        try:
            if player.socket:
                await player.socket.send_json({"type": "forced_leave", "message": "از اتاق خارج شدید"})
                await player.socket.close(code=1000)
        finally:
            await self.remove_player(player.id)

    async def handle(self, player: Player, payload: dict[str, Any]) -> None:
        kind = payload.get("type")
        if kind == "input":
            move = payload.get("move", [0, 0])
            aim = payload.get("aim", [player.aim_x, player.aim_y])
            try:
                if isinstance(move, list) and len(move) == 2:
                    player.move_x, player.move_y = movement_vector(float(move[0]), float(move[1]))
                if isinstance(aim, list) and len(aim) == 2:
                    ax, ay = normalize(float(aim[0]), float(aim[1]))
                    if ax or ay:
                        player.aim_x, player.aim_y = ax, ay
            except (TypeError, ValueError, OverflowError):
                return
            player.shooting = bool(payload.get("shooting", False))
            try:
                sequence = int(payload.get("seq", player.last_input_seq))
                if sequence >= player.last_input_seq:
                    player.last_input_seq = min(sequence, 2_147_483_647)
            except (TypeError, ValueError, OverflowError):
                pass
            player.last_input_at = time.monotonic()
        elif kind == "action" and self.phase == "playing" and player.alive:
            action = payload.get("action")
            now = time.monotonic()
            if action == "dash" and now >= player.dash_ready_at:
                player.dash_until = now + 0.28
                player.dash_ready_at = now + 4.0
            elif action == "shield" and now >= player.shield_ready_at:
                player.shield_until = max(player.shield_until, now + 1.4)
                player.shield_ready_at = now + 7.0
            elif action == "jump" and player.grounded:
                player.velocity_z = JUMP_VELOCITY
                player.grounded = False
            elif action == "grenade" and player.grenades > 0:
                self._throw_grenade(player, now)
            elif action == "rpg" and player.rockets > 0:
                self._launch_rpg(player, now)
        elif kind == "reset" and player.id == self.host_id:
            await self._reset_round(player)
        elif kind == "voice_join":
            mode = str(payload.get("mode", "team"))
            if mode not in {"team", "room"}:
                return
            if mode == "team" and player.team_id is None:
                await player.socket.send_json({"type": "error", "message": "برای گفت‌وگوی تیمی ابتدا عضو تیم شوید"})
                return
            player.voice_mode = mode
            await self._broadcast_voice_peers()
        elif kind == "voice_leave":
            player.voice_mode = None
            await self._broadcast_voice_peers()
        elif kind == "voice_signal":
            await self._relay_voice_signal(player, payload)
        elif kind == "choose_weapon":
            await self._choose_winner_weapon(player, str(payload.get("weapon", "")))
        elif kind == "select_map" and player.id == self.host_id and self.phase == "lobby":
            await self._select_map(str(payload.get("map", "")))
        elif kind == "set_bot_difficulty" and player.id == self.host_id and self.phase == "lobby":
            await self._set_bot_difficulty(str(payload.get("difficulty", "")))
        elif kind == "add_bot" and player.id == self.host_id and self.phase == "lobby":
            try:
                await self.add_bot()
            except ValueError as exc:
                await player.socket.send_json({"type": "error", "message": str(exc)})
        elif kind == "remove_bot" and player.id == self.host_id and self.phase == "lobby":
            await self.remove_bot()
        elif kind == "start" and player.id == self.host_id and self.phase == "lobby":
            if self.winner_id and not self.winner_choice and self.winner_id in self.players:
                return
            await self._start_round()

    async def _reset_round(self, player: Player) -> None:
        if player.id != self.host_id:
            return
        await self.broadcast_event("reset", f"{player.name} مسابقه را از نو شروع کرد")
        await self._start_round()

    def _voice_compatible(self, first: Player, second: Player) -> bool:
        if not first.voice_mode or not second.voice_mode:
            return False
        if first.voice_mode == "team" or second.voice_mode == "team":
            return first.team_id is not None and first.team_id == second.team_id
        return True

    async def _broadcast_voice_peers(self) -> None:
        people = [item for item in self.players.values() if not item.is_bot and item.socket and item.voice_mode]
        for listener in [item for item in self.players.values() if not item.is_bot and item.socket]:
            peers = [
                {"id": item.id, "name": item.name, "teamId": item.team_id, "mode": item.voice_mode}
                for item in people
                if item.id != listener.id and self._voice_compatible(listener, item)
            ] if listener.voice_mode else []
            try:
                await listener.socket.send_json({"type": "voice_peers", "peers": peers})
            except Exception:
                pass

    async def _relay_voice_signal(self, sender: Player, payload: dict[str, Any]) -> None:
        target_id = str(payload.get("target", ""))
        signal = payload.get("signal")
        target = self.players.get(target_id)
        if not target or target.is_bot or not isinstance(signal, dict) or not self._voice_compatible(sender, target):
            return
        if len(repr(signal)) > 7_000:
            return
        try:
            await target.socket.send_json({"type": "voice_signal", "from": sender.id, "signal": signal})
        except Exception:
            pass

    async def _select_map(self, map_id: str) -> None:
        if map_id not in MAPS or map_id == self.map_id:
            return
        self.map_id = map_id
        placed: list[Player] = []
        for member in self.players.values():
            member.x, member.y = spawn_point(placed, self.arena)
            member.z = 0.0
            member.velocity_z = 0.0
            member.grounded = True
            placed.append(member)
        await self._broadcast({"type": "arena", "arena": self.arena_public()})
        await self.broadcast_event("map", f"نقشه {self.arena['name']} انتخاب شد")

    async def _set_bot_difficulty(self, difficulty: str) -> None:
        if difficulty not in BOT_DIFFICULTIES or difficulty == self.bot_difficulty:
            return
        self.bot_difficulty = difficulty
        await self.broadcast_event(
            "bot_difficulty",
            f"قدرت بات‌ها: {BOT_DIFFICULTIES[difficulty]['name']}",
        )

    async def _choose_winner_weapon(self, player: Player, weapon: str) -> None:
        if (
            player.id != self.winner_id
            or self.phase not in {"ended", "lobby"}
            or self.winner_choice
            or weapon not in {"heavy", "rapid", "spread"}
        ):
            return
        player.reward_weapon = weapon
        self.winner_choice = weapon
        await self.broadcast_event("winner_weapon", f"{player.name} سلاح جایزه‌اش را انتخاب کرد")

    async def _start_round(self) -> None:
        self.phase = "countdown"
        self.countdown_until = time.monotonic() + 3.2
        self.round_size = len(self.players)
        self.bullets.clear()
        self.powerups.clear()
        self.projectiles.clear()
        self.explosions.clear()
        self.round_id = secrets.token_urlsafe(12)
        self.round_accounts = {}
        self.round_kills = {}
        self.match_recorded = False
        placed: list[Player] = []
        for member in self.players.values():
            member.score = 0
            member.health = 100
            member.lives = STARTING_LIVES
            member.alive = True
            member.respawn_at = 0.0
            member.move_x = member.move_y = 0.0
            member.shooting = False
            member.speed_until = 0.0
            member.shield_until = 0.0
            member.dash_until = 0.0
            member.z = 0.0
            member.velocity_z = 0.0
            member.grounded = True
            member.base_weapon = member.reward_weapon or "base"
            member.weapon = member.base_weapon
            member.weapon_until = 0.0
            member.radar_hidden_until = 0.0
            member.grenades = 0
            member.rockets = 0
            member.last_explosive_at = 0.0
            member.round_kills = 0
            member.reward_weapon = None
            member.x, member.y = spawn_point(placed, self.arena)
            placed.append(member)
            if member.account_id is not None:
                self.round_accounts[member.account_id] = member.name
                self.round_kills[member.account_id] = 0
        self.winner_id = None
        self.winner_name = ""
        self.winner_choice = ""
        await self.broadcast_event("start", "راند سه‌جان شروع می‌شود")

    async def _loop(self) -> None:
        tick = 1 / 60
        snapshot_clock = 0.0
        last = time.monotonic()
        while not self.closed:
            frame_started = time.monotonic()
            now = frame_started
            dt = min(now - last, 0.08)
            last = now

            if not any(not player.is_bot for player in self.players.values()):
                await asyncio.sleep(0.2)
                if not any(not player.is_bot for player in self.players.values()):
                    self.closed = True
                    break

            self._advance_phase(now)
            if self.phase == "playing":
                self._update_players(dt, now)
                self._update_bullets(dt, now)
                self._update_projectiles(dt, now)
                self._update_powerups(now)
                self._check_round_end(now)

            snapshot_clock += dt
            if snapshot_clock >= 1 / 30:
                snapshot_clock = 0.0
                await self.broadcast_state(now)

            elapsed = time.monotonic() - frame_started
            await asyncio.sleep(max(0.0, tick - elapsed))

    def _advance_phase(self, now: float) -> None:
        if self.phase == "countdown" and now >= self.countdown_until:
            self.phase = "playing"
            self.round_ends_at = now + ROUND_SECONDS
            self.next_powerup_at = now + POWERUP_FIRST_DELAY
        elif self.phase == "ended" and now >= self.return_to_lobby_at:
            self.phase = "lobby"
            self.bullets.clear()
            self.powerups.clear()

    def _update_players(self, dt: float, now: float) -> None:
        living = [player for player in self.players.values() if player.alive]
        for player in self.players.values():
            if not player.alive:
                if player.lives > 0 and now >= player.respawn_at:
                    player.alive = True
                    player.health = 100
                    player.x, player.y = spawn_point(living, self.arena)
                    player.z = 0.0
                    player.velocity_z = 0.0
                    player.grounded = True
                    living.append(player)
                continue

            if player.weapon_until and now >= player.weapon_until:
                player.weapon = player.base_weapon
                player.weapon_until = 0.0

            if player.is_bot:
                self._update_bot_input(player, now)
            elif now - player.last_input_at > 0.28:
                player.move_x = 0.0
                player.move_y = 0.0
                player.shooting = False

            speed_multiplier = 1.55 if now < player.speed_until else 1.0
            if now < player.dash_until:
                speed_multiplier *= 2.55
            if player.is_bot:
                speed_multiplier *= float(BOT_DIFFICULTIES[self.bot_difficulty]["speed"])

            support_before = surface_height(player.x, player.y, self.arena)
            if player.grounded:
                if abs(player.z - support_before) <= STEP_CLEARANCE:
                    player.z = support_before
                    player.velocity_z = 0.0
                else:
                    player.grounded = False
            if not player.grounded:
                player.velocity_z -= GRAVITY * dt
                player.z = max(0.0, player.z + player.velocity_z * dt)

            speed = PLAYER_SPEED * speed_multiplier
            width, height = float(self.arena["width"]), float(self.arena["height"])
            next_x = clamp(player.x + player.move_x * speed * dt, PLAYER_RADIUS, width - PLAYER_RADIUS)
            if clear_position(next_x, player.y, arena=self.arena, z=player.z):
                player.x = next_x
            next_y = clamp(player.y + player.move_y * speed * dt, PLAYER_RADIUS, height - PLAYER_RADIUS)
            if clear_position(player.x, next_y, arena=self.arena, z=player.z):
                player.y = next_y

            support_after = surface_height(player.x, player.y, self.arena)
            if player.velocity_z <= 0.0 and player.z <= support_after:
                player.z = support_after
                player.velocity_z = 0.0
                player.grounded = True
            elif player.grounded and abs(player.z - support_after) > STEP_CLEARANCE:
                player.grounded = False

            self._collect_powerups(player, now)
            if player.shooting:
                self._fire(player, now)

    def _update_bot_input(self, bot: Player, now: float) -> None:
        targets = [
            player for player in self.players.values()
            if player.id != bot.id and player.alive
            and not (bot.team_id is not None and bot.team_id == player.team_id)
        ]
        if not targets:
            bot.move_x = bot.move_y = 0.0
            bot.shooting = False
            return
        target = min(targets, key=lambda player: math.hypot(player.x - bot.x, player.y - bot.y))
        dx, dy = target.x - bot.x, target.y - bot.y
        distance = math.hypot(dx, dy) or 1.0
        difficulty = BOT_DIFFICULTIES[self.bot_difficulty]
        ideal_angle = math.atan2(dy, dx)
        noise_seed = sum(bot.id.encode()) * 0.021
        aim_error = math.sin(now * 2.15 + noise_seed) * float(difficulty["aim_error"])
        aim_x, aim_y = math.cos(ideal_angle + aim_error), math.sin(ideal_angle + aim_error)
        bot.aim_x, bot.aim_y = aim_x, aim_y
        forward = 1.0 if distance > 270 else -0.55 if distance < 145 else 0.0
        strafe = math.sin(now * 1.7 + sum(bot.id.encode()) * 0.03) * 0.72
        bot.move_x, bot.move_y = movement_vector(
            aim_x * forward - aim_y * strafe,
            aim_y * forward + aim_x * strafe,
        )
        bot.shooting = distance < float(difficulty["range"])
        bot.last_input_at = now
        if now >= bot.bot_dash_at and distance > 260 and now >= bot.dash_ready_at:
            bot.dash_until = now + 0.28
            bot.dash_ready_at = now + 4.0
            bot.bot_dash_at = now + random.uniform(4.0, 7.5)
        if now >= bot.bot_shield_at and bot.health < 75 and now >= bot.shield_ready_at:
            bot.shield_until = max(bot.shield_until, now + 1.4)
            bot.shield_ready_at = now + 7.0
            bot.bot_shield_at = now + random.uniform(6.0, 10.0)
        ahead_x = bot.x + bot.move_x * 52
        ahead_y = bot.y + bot.move_y * 52
        blocked_ahead = not clear_position(ahead_x, ahead_y, arena=self.arena, z=bot.z)
        if bot.grounded and now >= bot.bot_jump_at and (blocked_ahead or random.random() < 0.012):
            bot.velocity_z = JUMP_VELOCITY
            bot.grounded = False
            bot.bot_jump_at = now + random.uniform(2.4, 5.2)

    def _fire(self, player: Player, now: float) -> None:
        spec = WEAPON_SPECS.get(player.weapon, WEAPON_SPECS["base"])
        fire_delay = float(BOT_DIFFICULTIES[self.bot_difficulty]["fire_delay"]) if player.is_bot else 1.0
        if now - player.last_shot < spec["interval"] * fire_delay:
            return
        player.last_shot = now
        base_angle = math.atan2(player.aim_y, player.aim_x)
        for spread in spec["spread"]:
            angle = base_angle + spread
            dx, dy = math.cos(angle), math.sin(angle)
            start_x, start_y = player.x + dx * 31, player.y + dy * 31
            maximum = float(spec["range"])
            wall_distance = maximum
            shot_height = player.z + 48.0
            for obstacle in self.arena["obstacles"]:
                if shot_height > float(obstacle.get("height", 100)):
                    continue
                hit_distance = ray_rect_distance(start_x, start_y, dx, dy, obstacle, wall_distance)
                if hit_distance is not None:
                    wall_distance = hit_distance
            boundary_distances = []
            if dx > 1e-9:
                boundary_distances.append((float(self.arena["width"]) - start_x) / dx)
            elif dx < -1e-9:
                boundary_distances.append((0 - start_x) / dx)
            if dy > 1e-9:
                boundary_distances.append((float(self.arena["height"]) - start_y) / dy)
            elif dy < -1e-9:
                boundary_distances.append((0 - start_y) / dy)
            wall_distance = min([wall_distance, *(value for value in boundary_distances if value >= 0)])

            target: Player | None = None
            target_distance = wall_distance
            for candidate in self.players.values():
                if candidate.id == player.id or not candidate.alive:
                    continue
                if player.team_id is not None and player.team_id == candidate.team_id:
                    continue
                rel_x, rel_y = candidate.x - start_x, candidate.y - start_y
                projection = rel_x * dx + rel_y * dy
                if projection <= 0 or projection >= target_distance:
                    continue
                perpendicular_sq = rel_x * rel_x + rel_y * rel_y - projection * projection
                if perpendicular_sq > PLAYER_RADIUS * PLAYER_RADIUS:
                    continue
                entry = projection - math.sqrt(max(0.0, PLAYER_RADIUS * PLAYER_RADIUS - perpendicular_sq))
                if 0 <= entry < target_distance:
                    target, target_distance = candidate, entry

            end_distance = target_distance
            self.bullets.append(
                Bullet(
                    secrets.token_hex(4),
                    player.id,
                    start_x,
                    start_y,
                    start_x + dx * end_distance,
                    start_y + dy * end_distance,
                    shot_height,
                    player.color,
                    now + 0.16,
                    hit=target is not None,
                )
            )
            if target is not None:
                # Weapon damage is deterministic for humans and bots alike:
                # normal rounds remove 10 HP and heavy rounds remove 25 HP.
                damage = float(spec["damage"])
                if target.shield_until > now:
                    damage *= 0.25
                damage = max(1, round(damage))
                target.health = max(0, target.health - damage)
                if target.health == 0:
                    self._eliminate_life(target, player.id, now)

    def _update_bullets(self, dt: float, now: float) -> None:
        del dt
        self.bullets = [bullet for bullet in self.bullets if bullet.expires_at > now]

    def _throw_grenade(self, player: Player, now: float) -> None:
        if now - player.last_explosive_at < 0.65 or len(self.projectiles) >= 48:
            return
        player.last_explosive_at = now
        player.grenades -= 1
        self.projectiles.append(
            Projectile(
                id=secrets.token_hex(5),
                owner_id=player.id,
                kind="grenade",
                x=player.x + player.aim_x * 34,
                y=player.y + player.aim_y * 34,
                z=player.z + 48,
                vx=player.aim_x * GRENADE_SPEED,
                vy=player.aim_y * GRENADE_SPEED,
                vz=GRENADE_LIFT,
                explodes_at=now + GRENADE_FUSE,
            )
        )

    def _launch_rpg(self, player: Player, now: float) -> None:
        if now - player.last_explosive_at < 0.85 or len(self.projectiles) >= 48:
            return
        player.last_explosive_at = now
        player.rockets -= 1
        self.projectiles.append(
            Projectile(
                id=secrets.token_hex(5),
                owner_id=player.id,
                kind="rpg",
                x=player.x + player.aim_x * 38,
                y=player.y + player.aim_y * 38,
                z=player.z + 48,
                vx=player.aim_x * RPG_SPEED,
                vy=player.aim_y * RPG_SPEED,
                vz=0.0,
                explodes_at=now + 2.4,
            )
        )

    def _update_projectiles(self, dt: float, now: float) -> None:
        self.explosions = [item for item in self.explosions if item.expires_at > now]
        active: list[Projectile] = []
        for projectile in self.projectiles:
            old_x, old_y = projectile.x, projectile.y
            projectile.x += projectile.vx * dt
            projectile.y += projectile.vy * dt
            should_explode = now >= projectile.explodes_at

            if projectile.kind == "grenade":
                projectile.vz -= GRAVITY * dt
                projectile.z += projectile.vz * dt
                width, height = float(self.arena["width"]), float(self.arena["height"])
                if projectile.x < PROJECTILE_RADIUS or projectile.x > width - PROJECTILE_RADIUS:
                    projectile.x = clamp(projectile.x, PROJECTILE_RADIUS, width - PROJECTILE_RADIUS)
                    projectile.vx *= -0.55
                if projectile.y < PROJECTILE_RADIUS or projectile.y > height - PROJECTILE_RADIUS:
                    projectile.y = clamp(projectile.y, PROJECTILE_RADIUS, height - PROJECTILE_RADIUS)
                    projectile.vy *= -0.55
                for obstacle in self.arena["obstacles"]:
                    if projectile.z > float(obstacle.get("height", 100)):
                        continue
                    if not circle_hits_rect(projectile.x, projectile.y, PROJECTILE_RADIUS, obstacle):
                        continue
                    if not circle_hits_rect(old_x, projectile.y, PROJECTILE_RADIUS, obstacle):
                        projectile.vy *= -0.5
                    else:
                        projectile.vx *= -0.5
                    projectile.x, projectile.y = old_x, old_y
                    break
                floor = surface_height(projectile.x, projectile.y, self.arena)
                if projectile.z <= floor and projectile.vz < 0:
                    projectile.z = floor
                    if abs(projectile.vz) > 95:
                        projectile.vz *= -0.38
                        projectile.vx *= 0.76
                        projectile.vy *= 0.76
                    else:
                        projectile.vz = 0.0
                        projectile.vx *= 0.82
                        projectile.vy *= 0.82
            else:
                width, height = float(self.arena["width"]), float(self.arena["height"])
                if not (0 <= projectile.x <= width and 0 <= projectile.y <= height):
                    should_explode = True
                if any(
                    projectile.z <= float(obstacle.get("height", 100))
                    and circle_hits_rect(projectile.x, projectile.y, PROJECTILE_RADIUS, obstacle)
                    for obstacle in self.arena["obstacles"]
                ):
                    should_explode = True
                owner = self.players.get(projectile.owner_id)
                for target in self.players.values():
                    if target.id == projectile.owner_id or not target.alive:
                        continue
                    if owner and owner.team_id is not None and owner.team_id == target.team_id:
                        continue
                    if math.hypot(projectile.x - target.x, projectile.y - target.y) <= PLAYER_RADIUS + PROJECTILE_RADIUS:
                        should_explode = True
                        break

            if should_explode:
                self._explode_projectile(projectile, now)
            else:
                active.append(projectile)
        self.projectiles = active

    def _explode_projectile(self, projectile: Projectile, now: float) -> None:
        radius = 170.0 if projectile.kind == "grenade" else 205.0
        maximum_damage = 65 if projectile.kind == "grenade" else 85
        self.explosions.append(
            Explosion(
                id=secrets.token_hex(4),
                kind=projectile.kind,
                x=projectile.x,
                y=projectile.y,
                z=max(0.0, projectile.z),
                radius=radius,
                expires_at=now + 0.38,
            )
        )
        owner = self.players.get(projectile.owner_id)
        for target in self.players.values():
            if not target.alive or target.id == projectile.owner_id:
                continue
            if owner and owner.team_id is not None and owner.team_id == target.team_id:
                continue
            distance = math.hypot(projectile.x - target.x, projectile.y - target.y)
            if distance > radius:
                continue
            damage = max(12, round(maximum_damage * (1.0 - distance / radius)))
            if target.shield_until > now:
                damage = max(1, round(damage * 0.25))
            target.health = max(0, target.health - damage)
            if target.health == 0:
                self._eliminate_life(target, projectile.owner_id, now)

    def _eliminate_life(self, player: Player, owner_id: str, now: float) -> None:
        player.lives = max(0, player.lives - 1)
        player.alive = False
        player.shooting = False
        player.respawn_at = now + 1.7 if player.lives > 0 else math.inf
        owner = self.players.get(owner_id)
        if owner:
            owner.score += 1
            owner.round_kills += 1
            if owner.account_id is not None:
                self.round_kills[owner.account_id] = self.round_kills.get(owner.account_id, 0) + 1

    def _update_powerups(self, now: float) -> None:
        self.powerups = [item for item in self.powerups if item.expires_at > now]
        if now >= self.next_powerup_at and len(self.powerups) < MAX_POWERUPS:
            x, y = item_spawn_point(list(self.players.values()), self.powerups, self.arena)
            self.powerups.append(
                PowerUp(
                    id=secrets.token_hex(4),
                    kind=random.choice(tuple(POWERUP_LABELS)),
                    x=x,
                    y=y,
                    expires_at=now + POWERUP_TTL,
                )
            )
            self.next_powerup_at = now + random.uniform(POWERUP_SPAWN_MIN, POWERUP_SPAWN_MAX)

    def _collect_powerups(self, player: Player, now: float) -> None:
        collected = next(
            (item for item in self.powerups if math.hypot(player.x - item.x, player.y - item.y) <= PLAYER_RADIUS + 22),
            None,
        )
        if not collected:
            return
        self.powerups.remove(collected)
        self._apply_powerup(player, collected.kind, now)
        label = POWERUP_LABELS[collected.kind]
        asyncio.create_task(self.broadcast_event("powerup", f"{player.name}: {label}"))

    def _apply_powerup(self, player: Player, kind: str, now: float) -> None:
        if kind == "speed":
            player.speed_until = max(player.speed_until, now + 8.0)
        elif kind == "health":
            player.health = min(MAX_HEALTH, player.health + 45)
        elif kind == "shield":
            player.shield_until = max(player.shield_until, now + 6.0)
        elif kind == "weapon":
            player.weapon = random.choice(["heavy", "rapid", "spread"])
            player.weapon_until = now + 12.0
        elif kind == "stealth":
            player.radar_hidden_until = max(player.radar_hidden_until, now + 10.0)
        elif kind == "grenade":
            player.grenades = min(9, player.grenades + 3)
        elif kind == "rpg":
            player.rockets = min(9, player.rockets + 3)

    def _check_round_end(self, now: float) -> None:
        contenders = [player for player in self.players.values() if player.lives > 0]
        factions = {
            ("team", player.team_id) if player.team_id is not None else ("solo", player.id)
            for player in contenders
        }
        if self.round_size >= 2 and len(factions) <= 1:
            self._finish_round(contenders[0] if contenders else self._leader(), now)
        elif now >= self.round_ends_at:
            self._finish_round(self._leader(), now)

    def _leader(self) -> Player | None:
        return max(
            self.players.values(),
            key=lambda player: (player.lives, player.health, player.score, -player.joined_at),
            default=None,
        )

    def _finish_round(self, winner: Player | None, now: float) -> None:
        if self.phase != "playing":
            return
        self.phase = "ended"
        self.return_to_lobby_at = now + 12.0
        self.winner_id = winner.id if winner else None
        self.winner_name = winner.name if winner else "—"
        self.winner_choice = ""
        if winner and winner.is_bot:
            winner.reward_weapon = random.choice(["heavy", "rapid", "spread"])
            self.winner_choice = winner.reward_weapon
        if self.match_recorder and self.round_id and not self.match_recorded:
            winner_account_id = winner.account_id if winner and not winner.is_bot else None
            results = [
                {
                    "user_id": account_id,
                    "kills": self.round_kills.get(account_id, 0),
                    "won": account_id == winner_account_id,
                }
                for account_id in self.round_accounts
            ]
            try:
                self.match_recorder(self.round_id, self.code, self.map_id, results)
                self.match_recorded = True
            except Exception:
                # A temporary database problem must not stop a live game loop.
                pass
        self.bullets.clear()
        self.powerups.clear()
        self.projectiles.clear()

    def state(self, now: float) -> dict[str, Any]:
        remaining = 0
        countdown = 0
        if self.phase == "playing":
            remaining = max(0, math.ceil(self.round_ends_at - now))
        elif self.phase == "countdown":
            countdown = max(0, math.ceil(self.countdown_until - now))
        return {
            "type": "state",
            "room": self.code,
            "phase": self.phase,
            "hostId": self.host_id,
            "ownerUserId": self.owner_user_id,
            "remaining": remaining,
            "countdown": countdown,
            "winner": self.winner_name,
            "winnerId": self.winner_id,
            "winnerChoice": self.winner_choice,
            "mapId": self.map_id,
            "mapName": self.arena["name"],
            "botDifficulty": self.bot_difficulty,
            "players": [player.public(now) for player in self.players.values()],
            "bullets": [bullet.public() for bullet in self.bullets],
            "powerups": [item.public(now) for item in self.powerups],
            "projectiles": [item.public() for item in self.projectiles],
            "explosions": [item.public(now) for item in self.explosions],
        }

    async def broadcast_state(self, now: float) -> None:
        await self._broadcast(self.state(now))

    async def broadcast_event(self, event: str, message: str) -> None:
        await self._broadcast({"type": "event", "event": event, "message": message})

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        failed: list[str] = []
        for player in list(self.players.values()):
            if player.is_bot or player.socket is None:
                continue
            try:
                await player.socket.send_json(payload)
            except Exception:
                failed.append(player.id)
        for player_id in failed:
            self.players.pop(player_id, None)
            if self.host_id == player_id:
                self.host_id = (
                    None
                    if self.owner_user_id is not None
                    else next((item.id for item in self.players.values() if not item.is_bot), None)
                )


class GameHub:
    def __init__(
        self,
        match_recorder: Callable[[str, str, str, list[dict[str, Any]]], None] | None = None,
    ) -> None:
        self.rooms: dict[str, Room] = {}
        self.active_users: dict[int, str] = {}
        self.match_recorder = match_recorder

    def create_room(self, owner_user_id: int | None = None) -> tuple[Room, bool]:
        if owner_user_id is not None:
            existing = next(
                (
                    room for room in self.rooms.values()
                    if room.owner_user_id == owner_user_id and not room.closed
                ),
                None,
            )
            if existing:
                return existing, True
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        while True:
            code = "".join(secrets.choice(alphabet) for _ in range(4))
            if code not in self.rooms:
                room = Room(code, owner_user_id=owner_user_id, match_recorder=self.match_recorder)
                self.rooms[code] = room
                return room, False

    def claim_user(self, user_id: int, room_code: str) -> bool:
        current = self.active_users.get(user_id)
        if current and current != room_code:
            room = self.get_room(current)
            if room and any(player.account_id == user_id for player in room.players.values()):
                return False
        self.active_users[user_id] = room_code
        return True

    def release_user(self, user_id: int, room_code: str) -> None:
        if self.active_users.get(user_id) == room_code:
            self.active_users.pop(user_id, None)

    def get_room(self, code: str) -> Room | None:
        room = self.rooms.get(code.upper())
        if room and room.closed:
            self.rooms.pop(code.upper(), None)
            for user_id, room_code in list(self.active_users.items()):
                if room_code == code.upper():
                    self.active_users.pop(user_id, None)
            return None
        return room

    def stats(self) -> dict[str, int]:
        active = [room for room in self.rooms.values() if not room.closed]
        return {"rooms": len(active), "players": sum(len(room.players) for room in active)}

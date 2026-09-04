from __future__ import annotations

import asyncio
import math
import random
import secrets
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import WebSocket
else:
    WebSocket = Any


ARENA_WIDTH = 1200
ARENA_HEIGHT = 700
PLAYER_RADIUS = 21
PLAYER_SPEED = 275.0
BULLET_SPEED = 650.0
ROUND_SECONDS = 120
STARTING_LIVES = 3
MAX_HEALTH = 140
MAX_PLAYERS = 12
POWERUP_FIRST_DELAY = 3.5
POWERUP_SPAWN_MIN = 5.0
POWERUP_SPAWN_MAX = 7.0
POWERUP_TTL = 13.0

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

OBSTACLES = [
    {"x": 220, "y": 120, "w": 235, "h": 54},
    {"x": 760, "y": 95, "w": 58, "h": 205},
    {"x": 940, "y": 175, "w": 170, "h": 58},
    {"x": 500, "y": 280, "w": 205, "h": 65},
    {"x": 115, "y": 440, "w": 235, "h": 58},
    {"x": 470, "y": 520, "w": 70, "h": 135},
    {"x": 780, "y": 500, "w": 235, "h": 58},
]

POWERUP_LABELS = {
    "speed": "افزایش سرعت",
    "health": "خون اضافه",
    "shield": "سپر دفاعی",
    "weapon": "سلاح قوی‌تر",
}

WEAPON_SPECS: dict[str, dict[str, Any]] = {
    "base": {"interval": 0.24, "damage": 25, "speed": 650.0, "radius": 6, "spread": [0.0]},
    "heavy": {"interval": 0.42, "damage": 45, "speed": 570.0, "radius": 9, "spread": [0.0]},
    "rapid": {"interval": 0.12, "damage": 18, "speed": 760.0, "radius": 5, "spread": [0.0]},
    "spread": {"interval": 0.36, "damage": 17, "speed": 640.0, "radius": 5, "spread": [-0.17, 0.0, 0.17]},
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


def clear_position(x: float, y: float, radius: float = PLAYER_RADIUS) -> bool:
    if x < radius or x > ARENA_WIDTH - radius or y < radius or y > ARENA_HEIGHT - radius:
        return False
    return not any(circle_hits_rect(x, y, radius, obstacle) for obstacle in OBSTACLES)


def spawn_point(players: list["Player"]) -> tuple[float, float]:
    for _ in range(80):
        x = random.uniform(65, ARENA_WIDTH - 65)
        y = random.uniform(65, ARENA_HEIGHT - 65)
        if clear_position(x, y) and all(
            math.hypot(x - player.x, y - player.y) > 120 for player in players if player.alive
        ):
            return x, y
    return 80.0, 80.0


def item_spawn_point(players: list["Player"], items: list["PowerUp"]) -> tuple[float, float]:
    for _ in range(80):
        x = random.uniform(55, ARENA_WIDTH - 55)
        y = random.uniform(55, ARENA_HEIGHT - 55)
        if not clear_position(x, y, 24):
            continue
        if any(math.hypot(x - item.x, y - item.y) < 90 for item in items):
            continue
        if any(math.hypot(x - player.x, y - player.y) < 70 for player in players if player.alive):
            continue
        return x, y
    return ARENA_WIDTH / 2, ARENA_HEIGHT / 2


@dataclass(slots=True)
class Player:
    id: str
    name: str
    color: str
    socket: WebSocket
    x: float
    y: float
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
    reward_weapon: str | None = None
    is_bot: bool = False
    bot_dash_at: float = 0.0
    bot_shield_at: float = 0.0
    joined_at: float = field(default_factory=time.monotonic)

    def public(self, now: float) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "health": self.health,
            "lives": self.lives,
            "score": self.score,
            "alive": self.alive,
            "aim": [round(self.aim_x, 2), round(self.aim_y, 2)],
            "shield": self.shield_until > now,
            "speedBoost": self.speed_until > now,
            "dashing": self.dash_until > now,
            "weapon": self.weapon,
            "bot": self.is_bot,
            "ack": self.last_input_seq,
            "dashCooldown": round(max(0.0, self.dash_ready_at - now), 1),
            "shieldCooldown": round(max(0.0, self.shield_ready_at - now), 1),
        }


@dataclass(slots=True)
class Bullet:
    id: str
    owner_id: str
    x: float
    y: float
    vx: float
    vy: float
    color: str
    damage: int
    radius: int
    expires_at: float

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "owner": self.owner_id,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "vx": round(self.vx, 1),
            "vy": round(self.vy, 1),
            "color": self.color,
            "radius": self.radius,
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


class Room:
    def __init__(self, code: str) -> None:
        self.code = code
        self.players: dict[str, Player] = {}
        self.bullets: list[Bullet] = []
        self.powerups: list[PowerUp] = []
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
        self.task: asyncio.Task[None] | None = None
        self.closed = False

    def start_loop(self) -> None:
        if not self.task or self.task.done():
            self.task = asyncio.create_task(self._loop())

    async def add_player(self, socket: WebSocket, name: str) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("این اتاق پر است")
        player_id = secrets.token_urlsafe(8)
        used_colors = {player.color for player in self.players.values()}
        color = next((item for item in COLORS if item not in used_colors), random.choice(COLORS))
        x, y = spawn_point(list(self.players.values()))
        player = Player(player_id, name, color, socket, x, y)
        self.players[player_id] = player
        if self.host_id is None:
            self.host_id = player_id
        self.start_loop()
        await socket.send_json(
            {
                "type": "welcome",
                "playerId": player_id,
                "room": self.code,
                "hostId": self.host_id,
                "arena": {"width": ARENA_WIDTH, "height": ARENA_HEIGHT, "obstacles": OBSTACLES},
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
        x, y = spawn_point(list(self.players.values()))
        bot = Player(player_id, f"بات {bot_number}", color, None, x, y, is_bot=True)
        bot.bot_dash_at = time.monotonic() + random.uniform(2.0, 5.0)
        bot.bot_shield_at = time.monotonic() + random.uniform(3.0, 6.0)
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
            self.host_id = next((item.id for item in self.players.values() if not item.is_bot), None)
        if self.winner_id == player_id and not self.winner_choice:
            self.winner_choice = "base"
        await self.broadcast_event("leave", f"{player.name} از بازی خارج شد")

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
        elif kind == "choose_weapon":
            await self._choose_winner_weapon(player, str(payload.get("weapon", "")))
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
            member.base_weapon = member.reward_weapon or "base"
            member.weapon = member.base_weapon
            member.weapon_until = 0.0
            member.reward_weapon = None
            member.x, member.y = spawn_point(list(self.players.values()))
        self.winner_id = None
        self.winner_name = ""
        self.winner_choice = ""
        await self.broadcast_event("start", "راند سه‌جان شروع می‌شود")

    async def _loop(self) -> None:
        tick = 1 / 45
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
                self._update_powerups(now)
                self._check_round_end(now)

            snapshot_clock += dt
            if snapshot_clock >= 1 / 20:
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
                    player.x, player.y = spawn_point(living)
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
            speed = PLAYER_SPEED * speed_multiplier
            next_x = clamp(player.x + player.move_x * speed * dt, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS)
            if clear_position(next_x, player.y):
                player.x = next_x
            next_y = clamp(player.y + player.move_y * speed * dt, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS)
            if clear_position(player.x, next_y):
                player.y = next_y

            self._collect_powerups(player, now)
            if player.shooting:
                self._fire(player, now)

    def _update_bot_input(self, bot: Player, now: float) -> None:
        targets = [player for player in self.players.values() if player.id != bot.id and player.alive]
        if not targets:
            bot.move_x = bot.move_y = 0.0
            bot.shooting = False
            return
        target = min(targets, key=lambda player: math.hypot(player.x - bot.x, player.y - bot.y))
        dx, dy = target.x - bot.x, target.y - bot.y
        distance = math.hypot(dx, dy) or 1.0
        aim_x, aim_y = dx / distance, dy / distance
        bot.aim_x, bot.aim_y = aim_x, aim_y
        forward = 1.0 if distance > 270 else -0.55 if distance < 145 else 0.0
        strafe = math.sin(now * 1.7 + sum(bot.id.encode()) * 0.03) * 0.72
        bot.move_x, bot.move_y = movement_vector(
            aim_x * forward - aim_y * strafe,
            aim_y * forward + aim_x * strafe,
        )
        bot.shooting = distance < 610
        bot.last_input_at = now
        if now >= bot.bot_dash_at and distance > 260 and now >= bot.dash_ready_at:
            bot.dash_until = now + 0.28
            bot.dash_ready_at = now + 4.0
            bot.bot_dash_at = now + random.uniform(4.0, 7.5)
        if now >= bot.bot_shield_at and bot.health < 75 and now >= bot.shield_ready_at:
            bot.shield_until = max(bot.shield_until, now + 1.4)
            bot.shield_ready_at = now + 7.0
            bot.bot_shield_at = now + random.uniform(6.0, 10.0)

    def _fire(self, player: Player, now: float) -> None:
        spec = WEAPON_SPECS.get(player.weapon, WEAPON_SPECS["base"])
        if now - player.last_shot < spec["interval"]:
            return
        player.last_shot = now
        base_angle = math.atan2(player.aim_y, player.aim_x)
        for spread in spec["spread"]:
            angle = base_angle + spread
            dx, dy = math.cos(angle), math.sin(angle)
            self.bullets.append(
                Bullet(
                    secrets.token_hex(4),
                    player.id,
                    player.x + dx * 31,
                    player.y + dy * 31,
                    dx * spec["speed"],
                    dy * spec["speed"],
                    player.color,
                    spec["damage"],
                    spec["radius"],
                    now + 1.8,
                )
            )

    def _update_bullets(self, dt: float, now: float) -> None:
        remaining: list[Bullet] = []
        for bullet in self.bullets:
            bullet.x += bullet.vx * dt
            bullet.y += bullet.vy * dt
            if (
                now >= bullet.expires_at
                or bullet.x < 0
                or bullet.x > ARENA_WIDTH
                or bullet.y < 0
                or bullet.y > ARENA_HEIGHT
                or any(circle_hits_rect(bullet.x, bullet.y, bullet.radius, obstacle) for obstacle in OBSTACLES)
            ):
                continue

            hit = False
            for player in self.players.values():
                if not player.alive or player.id == bullet.owner_id:
                    continue
                if math.hypot(player.x - bullet.x, player.y - bullet.y) <= PLAYER_RADIUS + bullet.radius:
                    damage = max(1, round(bullet.damage * 0.25)) if player.shield_until > now else bullet.damage
                    player.health = max(0, player.health - damage)
                    if player.health == 0:
                        self._eliminate_life(player, bullet.owner_id, now)
                    hit = True
                    break
            if not hit:
                remaining.append(bullet)
        self.bullets = remaining

    def _eliminate_life(self, player: Player, owner_id: str, now: float) -> None:
        player.lives = max(0, player.lives - 1)
        player.alive = False
        player.shooting = False
        player.respawn_at = now + 1.7 if player.lives > 0 else math.inf
        owner = self.players.get(owner_id)
        if owner:
            owner.score += 1

    def _update_powerups(self, now: float) -> None:
        self.powerups = [item for item in self.powerups if item.expires_at > now]
        if now >= self.next_powerup_at and len(self.powerups) < 4:
            x, y = item_spawn_point(list(self.players.values()), self.powerups)
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

    def _check_round_end(self, now: float) -> None:
        contenders = [player for player in self.players.values() if player.lives > 0]
        if self.round_size >= 2 and len(contenders) <= 1:
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
        self.bullets.clear()
        self.powerups.clear()

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
            "remaining": remaining,
            "countdown": countdown,
            "winner": self.winner_name,
            "winnerId": self.winner_id,
            "winnerChoice": self.winner_choice,
            "players": [player.public(now) for player in self.players.values()],
            "bullets": [bullet.public() for bullet in self.bullets],
            "powerups": [item.public(now) for item in self.powerups],
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
                self.host_id = next((item.id for item in self.players.values() if not item.is_bot), None)


class GameHub:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}

    def create_room(self) -> Room:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        while True:
            code = "".join(secrets.choice(alphabet) for _ in range(4))
            if code not in self.rooms:
                room = Room(code)
                self.rooms[code] = room
                return room

    def get_room(self, code: str) -> Room | None:
        room = self.rooms.get(code.upper())
        if room and room.closed:
            self.rooms.pop(code.upper(), None)
            return None
        return room

    def stats(self) -> dict[str, int]:
        active = [room for room in self.rooms.values() if not room.closed]
        return {"rooms": len(active), "players": sum(len(room.players) for room in active)}

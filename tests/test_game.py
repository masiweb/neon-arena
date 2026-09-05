import asyncio
import math
import time
import unittest

from server.game import (
    BOT_DIFFICULTIES,
    JUMP_VELOCITY,
    OBSTACLES,
    STARTING_LIVES,
    WEAPON_SPECS,
    GameHub,
    Player,
    Room,
    clear_position,
    movement_vector,
    normalize,
    ray_rect_distance,
    surface_height,
)
from server.maps import DEFAULT_MAP_ID, MAPS, MAP_HEIGHT, MAP_WIDTH


class DummySocket:
    async def send_json(self, _payload: dict) -> None:
        return None


def make_player(player_id: str = "p1") -> Player:
    return Player(player_id, "Tester", "#20d9ff", DummySocket(), 100, 100)


class GameRulesTests(unittest.TestCase):
    def test_ray_rectangle_intersection(self) -> None:
        rect = {"x": 100, "y": 40, "w": 20, "h": 80}
        self.assertEqual(ray_rect_distance(0, 80, 1, 0, rect, 500), 100)
        self.assertIsNone(ray_rect_distance(0, 10, 1, 0, rect, 500))

    def test_hitscan_shot_hits_player_and_stops_at_wall(self) -> None:
        room = Room("TEST")
        shooter = make_player("shooter")
        target = make_player("target")
        room.players = {shooter.id: shooter, target.id: target}
        shooter.x, shooter.y = 50, 350
        target.x, target.y = 130, 350
        shooter.aim_x, shooter.aim_y = 1, 0
        room._fire(shooter, time.monotonic())
        self.assertEqual(target.health, 90)
        self.assertEqual(len(room.bullets), 1)
        self.assertGreater(room.bullets[0].x2, room.bullets[0].x1)
        self.assertTrue(room.bullets[0].hit)

        target.health = 100
        shooter.last_shot = 0
        shooter.x, shooter.y = 200, 300
        target.x, target.y = 1250, 300
        room._fire(shooter, time.monotonic())
        self.assertEqual(target.health, 100)
        self.assertFalse(room.bullets[-1].hit)

    def test_normalize_caps_vector(self) -> None:
        x, y = normalize(3, 4)
        self.assertEqual(round(x, 2), 0.6)
        self.assertEqual(round(y, 2), 0.8)

    def test_movement_vector_preserves_joystick_pressure(self) -> None:
        self.assertEqual(movement_vector(0.5, 0.0), (0.5, 0.0))
        self.assertEqual(movement_vector(0.03, 0.02), (0.0, 0.0))
        x, y = movement_vector(3.0, 4.0)
        self.assertAlmostEqual(x, 0.6)
        self.assertAlmostEqual(y, 0.8)

    def test_obstacle_positions_are_blocked(self) -> None:
        obstacle = OBSTACLES[0]
        self.assertFalse(clear_position(obstacle["x"] + 10, obstacle["y"] + 10))
        self.assertTrue(all(40 <= obstacle["height"] <= 170 for obstacle in OBSTACLES))

    def test_six_large_maps_are_available(self) -> None:
        self.assertEqual(len(MAPS), 6)
        self.assertIn(DEFAULT_MAP_ID, MAPS)
        self.assertTrue(all(item["width"] == MAP_WIDTH == 3600 for item in MAPS.values()))
        self.assertTrue(all(item["height"] == MAP_HEIGHT == 2100 for item in MAPS.values()))
        self.assertTrue(all(item["obstacles"] for item in MAPS.values()))
        self.assertTrue(all(any(wall["height"] <= 65 for wall in item["obstacles"]) for item in MAPS.values()))
        self.assertTrue(all(
            0 <= wall["x"] < wall["x"] + wall["w"] <= item["width"]
            and 0 <= wall["y"] < wall["y"] + wall["h"] <= item["height"]
            for item in MAPS.values()
            for wall in item["obstacles"]
        ))

    def test_low_walls_can_be_crossed_at_their_top(self) -> None:
        low_wall = next(item for item in OBSTACLES if item["height"] <= 60)
        x = low_wall["x"] + low_wall["w"] / 2
        y = low_wall["y"] + low_wall["h"] / 2
        self.assertFalse(clear_position(x, y, arena=MAPS[DEFAULT_MAP_ID], z=0))
        self.assertTrue(clear_position(x, y, arena=MAPS[DEFAULT_MAP_ID], z=low_wall["height"]))
        self.assertEqual(surface_height(x, y), low_wall["height"])

    def test_room_codes_are_unique_and_mobile_friendly(self) -> None:
        hub = GameHub()
        codes = {hub.create_room().code for _ in range(200)}
        self.assertEqual(len(codes), 200)
        self.assertTrue(all(len(code) == 4 and "0" not in code and "O" not in code for code in codes))

    def test_players_start_with_three_lives(self) -> None:
        player = make_player()
        self.assertEqual(player.lives, STARTING_LIVES)
        room = Room("TEST")
        room.players[player.id] = player
        room._eliminate_life(player, "missing", time.monotonic())
        self.assertEqual(player.lives, 2)
        self.assertTrue(math.isfinite(player.respawn_at))
        room._eliminate_life(player, "missing", time.monotonic())
        room._eliminate_life(player, "missing", time.monotonic())
        self.assertEqual(player.lives, 0)
        self.assertTrue(math.isinf(player.respawn_at))

    def test_powerups_apply_expected_effects(self) -> None:
        room = Room("TEST")
        player = make_player()
        now = time.monotonic()
        player.health = 90
        room._apply_powerup(player, "health", now)
        room._apply_powerup(player, "speed", now)
        room._apply_powerup(player, "shield", now)
        room._apply_powerup(player, "weapon", now)
        room._apply_powerup(player, "stealth", now)
        self.assertEqual(player.health, 135)
        self.assertGreater(player.speed_until, now)
        self.assertGreater(player.shield_until, now)
        self.assertIn(player.weapon, {"heavy", "rapid", "spread"})
        self.assertGreater(player.radar_hidden_until, now)
        self.assertTrue(player.public(now)["radarHidden"])

    def test_winner_can_choose_next_round_weapon(self) -> None:
        room = Room("TEST")
        player = make_player()
        room.players[player.id] = player
        room.winner_id = player.id
        room.phase = "ended"
        asyncio.run(room.handle(player, {"type": "choose_weapon", "weapon": "heavy"}))
        self.assertEqual(player.reward_weapon, "heavy")
        self.assertEqual(room.winner_choice, "heavy")
        room.phase = "lobby"
        room.host_id = player.id
        asyncio.run(room.handle(player, {"type": "start"}))
        self.assertEqual(player.base_weapon, "heavy")
        self.assertEqual(player.weapon, "heavy")
        self.assertEqual(player.lives, STARTING_LIVES)

    def test_input_sequence_is_acknowledged(self) -> None:
        room = Room("TEST")
        player = make_player()
        asyncio.run(room.handle(player, {
            "type": "input",
            "seq": 42,
            "move": [0.5, 0.0],
            "aim": [1.0, 0.0],
            "shooting": True,
        }))
        self.assertEqual(player.last_input_seq, 42)
        self.assertEqual(player.public(time.monotonic())["ack"], 42)
        self.assertEqual(player.move_x, 0.5)
        self.assertTrue(player.shooting)

    def test_jump_action_and_landing_are_server_authoritative(self) -> None:
        room = Room("TEST")
        player = make_player()
        room.players[player.id] = player
        room.phase = "playing"
        asyncio.run(room.handle(player, {"type": "action", "action": "jump"}))
        self.assertFalse(player.grounded)
        self.assertEqual(player.velocity_z, JUMP_VELOCITY)
        room._update_players(0.08, time.monotonic())
        self.assertGreater(player.z, 0)

    def test_player_can_jump_onto_a_low_wall(self) -> None:
        room = Room("TEST")
        low_wall = next(item for item in room.arena["obstacles"] if item["height"] <= 60)
        player = make_player()
        player.x = low_wall["x"] - 45
        player.y = low_wall["y"] + low_wall["h"] / 2
        player.move_x = 1
        room.players[player.id] = player
        room.phase = "playing"
        asyncio.run(room.handle(player, {"type": "action", "action": "jump"}))
        started = time.monotonic()
        for frame in range(58):
            now = started + frame / 60
            player.last_input_at = now
            room._update_players(1 / 60, now)
        self.assertTrue(player.grounded)
        self.assertEqual(player.z, low_wall["height"])
        self.assertGreaterEqual(player.x, low_wall["x"])
        self.assertLessEqual(player.x, low_wall["x"] + low_wall["w"])

    def test_host_selects_map_and_bot_difficulty(self) -> None:
        room = Room("TEST")
        host = make_player()
        room.players[host.id] = host
        room.host_id = host.id
        asyncio.run(room.handle(host, {"type": "select_map", "map": "reactor"}))
        asyncio.run(room.handle(host, {"type": "set_bot_difficulty", "difficulty": "hard"}))
        self.assertEqual(room.map_id, "reactor")
        self.assertEqual(room.bot_difficulty, "hard")
        self.assertEqual(room.state(time.monotonic())["mapName"], MAPS["reactor"]["name"])
        self.assertEqual(set(BOT_DIFFICULTIES), {"easy", "normal", "hard"})

    def test_weapon_damage_balance(self) -> None:
        self.assertEqual(WEAPON_SPECS["base"]["damage"], 10)
        self.assertEqual(WEAPON_SPECS["heavy"]["damage"], 25)

        room = Room("TEST")
        room.bot_difficulty = "hard"
        bot = make_player("bot")
        bot.is_bot = True
        target = make_player("target")
        bot.x, bot.y = 50, 350
        target.x, target.y = 130, 350
        bot.aim_x, bot.aim_y = 1, 0
        room.players = {bot.id: bot, target.id: target}
        room._fire(bot, time.monotonic())
        self.assertEqual(target.health, 90)
        bot.weapon = "heavy"
        bot.last_shot = 0
        room._fire(bot, time.monotonic())
        self.assertEqual(target.health, 65)

    def test_round_start_places_players_apart(self) -> None:
        room = Room("TEST")
        players = [make_player(f"p{index}") for index in range(6)]
        room.players = {player.id: player for player in players}
        asyncio.run(room._start_round())
        for index, player in enumerate(players):
            self.assertTrue(clear_position(player.x, player.y, arena=room.arena))
            for other in players[index + 1:]:
                self.assertGreater(math.hypot(player.x - other.x, player.y - other.y), 120)

    def test_host_can_add_and_remove_bot(self) -> None:
        async def scenario() -> None:
            room = Room("TEST")
            host = make_player()
            room.players[host.id] = host
            room.host_id = host.id
            await room.handle(host, {"type": "add_bot"})
            bots = [player for player in room.players.values() if player.is_bot]
            self.assertEqual(len(bots), 1)
            self.assertTrue(bots[0].public(time.monotonic())["bot"])
            room._update_bot_input(bots[0], time.monotonic())
            self.assertTrue(math.isfinite(bots[0].aim_x))
            await room.handle(host, {"type": "remove_bot"})
            self.assertFalse(any(player.is_bot for player in room.players.values()))
            if room.task:
                room.task.cancel()

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()

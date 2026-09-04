import asyncio
import math
import time
import unittest

from server.game import (
    OBSTACLES,
    STARTING_LIVES,
    GameHub,
    Player,
    Room,
    clear_position,
    movement_vector,
    normalize,
    ray_rect_distance,
)


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
        self.assertLess(target.health, 100)
        self.assertEqual(len(room.bullets), 1)
        self.assertGreater(room.bullets[0].x2, room.bullets[0].x1)
        self.assertTrue(room.bullets[0].hit)

        target.health = 100
        shooter.last_shot = 0
        shooter.x, shooter.y = 200, 350
        target.x, target.y = 400, 350
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
        self.assertTrue(all(40 <= obstacle["height"] <= 100 for obstacle in OBSTACLES))

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

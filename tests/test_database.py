import tempfile
import unittest
from pathlib import Path

from server.database import AccountError, Database, ECONOMY_RULES


class DatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.temp.name) / "game.db")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def register(self, number: int):
        return self.database.register(f"user{number}@example.com", f"player_{number}", f"Password{number}")

    def test_registration_login_reset_and_referral(self) -> None:
        token, first = self.register(1)
        self.assertEqual(first["gold"], ECONOMY_RULES["signup_gold"])
        second_token, second = self.database.register(
            "user2@example.com", "player_2", "Password2", first["referralCode"]
        )
        self.assertTrue(self.database.user_from_token(token))
        self.assertTrue(self.database.user_from_token(second_token))
        self.assertEqual(second["gold"], ECONOMY_RULES["signup_gold"] + ECONOMY_RULES["referral_gold_each"])
        self.assertEqual(self.database.get_user(first["id"])["gold"], ECONOMY_RULES["signup_gold"] + ECONOMY_RULES["referral_gold_each"])
        reset, _user = self.database.create_password_reset("user1@example.com")
        self.database.reset_password(reset, "Changed123")
        with self.assertRaises(AccountError):
            self.database.login("user1@example.com", "Password1")
        self.assertTrue(self.database.login("user1@example.com", "Changed123")[0])

    def test_friends_blocks_and_team_limit(self) -> None:
        users = [self.register(index)[1] for index in range(1, 8)]
        request = self.database.send_friend_request(users[0]["id"], users[1]["username"])
        self.assertEqual(request["status"], "pending")
        received = self.database.social(users[1]["id"])["received"]
        self.database.respond_friend_request(users[1]["id"], received[0]["requestId"], True)
        self.assertEqual(len(self.database.social(users[0]["id"])["friends"]), 1)
        self.database.block_user(users[0]["id"], users[1]["id"])
        self.assertEqual(len(self.database.social(users[0]["id"])["blocked"]), 1)
        self.database.unblock_user(users[0]["id"], users[1]["id"])

        team = self.database.create_team(users[0]["id"], "Neon Six")
        for user in users[1:6]:
            self.database.join_team(user["id"], team["inviteCode"])
        self.assertEqual(len(self.database.team_for_user(users[0]["id"])["members"]), 6)
        with self.assertRaises(AccountError):
            self.database.join_team(users[6]["id"], team["inviteCode"])
        self.database.leave_team(users[0]["id"])
        migrated = self.database.team_for_user(users[1]["id"])
        self.assertNotEqual(migrated["ownerId"], users[0]["id"])

    def test_shop_admin_and_match_rewards_are_idempotent(self) -> None:
        _admin_token, admin = self.register(1)
        _user_token, user = self.register(2)
        self.database.promote_admin(admin["email"])
        product = self.database.products()[0]
        order = self.database.create_order(user["id"], product["id"])
        approved = self.database.review_order(admin["id"], order["id"], True, "track-1")
        self.assertEqual(approved["status"], "paid")
        after_order = self.database.get_user(user["id"])
        self.assertEqual(after_order["gold"], ECONOMY_RULES["signup_gold"] + product["grantGold"])
        result = [{"user_id": user["id"], "kills": 2, "won": True}]
        self.database.record_match("round-one", "ABCD", "citadel", result)
        rewarded = self.database.get_user(user["id"])
        self.database.record_match("round-one", "ABCD", "citadel", result)
        duplicate = self.database.get_user(user["id"])
        self.assertEqual(rewarded["xp"], duplicate["xp"])
        self.assertEqual(rewarded["diamonds"], duplicate["diamonds"])
        self.assertEqual(rewarded["gamesPlayed"], 1)
        self.assertEqual(rewarded["wins"], 1)


if __name__ == "__main__":
    unittest.main()

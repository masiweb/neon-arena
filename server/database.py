from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
import unicodedata
from contextlib import contextmanager
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Iterator


SESSION_SECONDS = 30 * 24 * 60 * 60
RESET_SECONDS = 30 * 60
USERNAME_RE = re.compile(r"^[\w.-]{3,20}$", re.UNICODE)
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

RANKS = (
    (0, "تازه‌کار"),
    (500, "مبارز"),
    (1_500, "نخبه"),
    (3_500, "فرمانده"),
    (7_000, "اسطوره"),
)

ECONOMY_RULES = {
    "signup_gold": 250,
    "referral_gold_each": 100,
    "participation_xp": 25,
    "participation_gold": 10,
    "kill_xp": 20,
    "kill_gold": 15,
    "winner_xp": 100,
    "winner_gold": 75,
    "winner_diamonds": 1,
}


class AccountError(ValueError):
    pass


def _now() -> int:
    return int(time.time())


def normalize_email(value: str) -> str:
    email = unicodedata.normalize("NFKC", value).strip().casefold()
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        raise AccountError("ایمیل معتبر وارد کنید")
    return email


def normalize_username(value: str) -> tuple[str, str]:
    username = unicodedata.normalize("NFKC", value).strip()
    if not USERNAME_RE.fullmatch(username) or username.startswith((".", "-")):
        raise AccountError("نام کاربری باید ۳ تا ۲۰ حرف، عدد، نقطه یا زیرخط باشد")
    return username, username.casefold()


def validate_password(value: str) -> str:
    if len(value) < 8 or len(value) > 128:
        raise AccountError("رمز عبور باید حداقل ۸ کاراکتر باشد")
    if not any(char.isalpha() for char in value) or not any(char.isdigit() for char in value):
        raise AccountError("رمز عبور باید شامل حرف و عدد باشد")
    return value


def validate_admin_password(value: str) -> str:
    if len(value) < 14 or len(value) > 128:
        raise AccountError("رمز مدیریت باید حداقل ۱۴ کاراکتر باشد")
    checks = (
        any(char.islower() for char in value),
        any(char.isupper() for char in value),
        any(char.isdigit() for char in value),
        any(not char.isalnum() for char in value),
    )
    if not all(checks):
        raise AccountError("رمز مدیریت باید شامل حروف بزرگ و کوچک، عدد و نماد باشد")
    return value


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, raw_n, raw_r, raw_p, raw_salt, expected = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(raw_salt),
            n=int(raw_n),
            r=int(raw_r),
            p=int(raw_p),
            dklen=32,
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def rank_for_xp(xp: int) -> dict[str, Any]:
    current_index = 0
    for index, (minimum, _name) in enumerate(RANKS):
        if xp >= minimum:
            current_index = index
    minimum, name = RANKS[current_index]
    next_minimum = RANKS[current_index + 1][0] if current_index + 1 < len(RANKS) else None
    return {
        "name": name,
        "level": current_index + 1,
        "minimumXp": minimum,
        "nextXp": next_minimum,
    }


class Database:
    def __init__(self, path: str | Path | None = None) -> None:
        selected = path or os.environ.get("NEON_DATABASE", "")
        if selected:
            self.path = Path(selected)
        else:
            self.path = Path(__file__).resolve().parent / "data" / "neon-arena.db"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connection() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL UNIQUE,
                    username TEXT NOT NULL,
                    username_key TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    referral_code TEXT NOT NULL UNIQUE,
                    referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    is_admin INTEGER NOT NULL DEFAULT 0,
                    must_change_password INTEGER NOT NULL DEFAULT 0,
                    password_changed_at INTEGER,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    gold INTEGER NOT NULL DEFAULT 250 CHECK(gold >= 0),
                    diamonds INTEGER NOT NULL DEFAULT 0 CHECK(diamonds >= 0),
                    xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0),
                    rating INTEGER NOT NULL DEFAULT 1000 CHECK(rating >= 0),
                    kills INTEGER NOT NULL DEFAULT 0 CHECK(kills >= 0),
                    wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
                    games_played INTEGER NOT NULL DEFAULT 0 CHECK(games_played >= 0),
                    best_player_count INTEGER NOT NULL DEFAULT 0 CHECK(best_player_count >= 0),
                    created_at INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

                CREATE TABLE IF NOT EXISTS password_resets (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at INTEGER NOT NULL,
                    used_at INTEGER,
                    created_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS blocks (
                    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY(blocker_id, blocked_id),
                    CHECK(blocker_id != blocked_id)
                );

                CREATE TABLE IF NOT EXISTS friendships (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_low INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    user_high INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    UNIQUE(user_low, user_high),
                    CHECK(user_low < user_high)
                );

                CREATE TABLE IF NOT EXISTS teams (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    invite_code TEXT NOT NULL UNIQUE,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS team_members (
                    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    joined_at INTEGER NOT NULL,
                    PRIMARY KEY(team_id, user_id)
                );

                CREATE TABLE IF NOT EXISTS shop_products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sku TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    grant_gold INTEGER NOT NULL DEFAULT 0 CHECK(grant_gold >= 0),
                    grant_diamonds INTEGER NOT NULL DEFAULT 0 CHECK(grant_diamonds >= 0),
                    price_irr INTEGER NOT NULL CHECK(price_irr >= 0),
                    active INTEGER NOT NULL DEFAULT 1,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS purchase_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    product_id INTEGER NOT NULL REFERENCES shop_products(id),
                    amount_irr INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected','cancelled')),
                    tracking_code TEXT,
                    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at INTEGER NOT NULL,
                    reviewed_at INTEGER
                );

                CREATE TABLE IF NOT EXISTS currency_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    currency TEXT NOT NULL CHECK(currency IN ('gold','diamonds')),
                    amount INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    reference TEXT,
                    created_at INTEGER NOT NULL,
                    UNIQUE(user_id, currency, reference)
                );

                CREATE TABLE IF NOT EXISTS match_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    round_id TEXT NOT NULL,
                    room_code TEXT NOT NULL,
                    map_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    kills INTEGER NOT NULL DEFAULT 0,
                    won INTEGER NOT NULL DEFAULT 0,
                    xp_awarded INTEGER NOT NULL DEFAULT 0,
                    gold_awarded INTEGER NOT NULL DEFAULT 0,
                    diamonds_awarded INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    UNIQUE(round_id, user_id)
                );

                CREATE TABLE IF NOT EXISTS advertisements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL DEFAULT '',
                    image_url TEXT NOT NULL DEFAULT '',
                    target_url TEXT NOT NULL DEFAULT '',
                    placement TEXT NOT NULL DEFAULT 'lobby' CHECK(placement IN ('login','lobby','result')),
                    active INTEGER NOT NULL DEFAULT 1,
                    starts_at INTEGER,
                    ends_at INTEGER,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS admin_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    action TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    detail TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL
                );
                """
            )
            user_columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
            if "must_change_password" not in user_columns:
                db.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")
            if "password_changed_at" not in user_columns:
                db.execute("ALTER TABLE users ADD COLUMN password_changed_at INTEGER")
            self._seed_products(db)

    def _seed_products(self, db: sqlite3.Connection) -> None:
        now = _now()
        products = (
            ("gold-1200", "۱٬۲۰۰ طلا", "بسته شروع سریع", 1200, 0, 49_000, 10),
            ("gold-3500", "۳٬۵۰۰ طلا", "بسته مبارز", 3500, 0, 119_000, 20),
            ("diamond-25", "۲۵ الماس", "بسته الماس", 0, 25, 89_000, 30),
            ("diamond-80", "۸۰ الماس", "بسته فرمانده", 0, 80, 249_000, 40),
        )
        db.executemany(
            """
            INSERT OR IGNORE INTO shop_products
                (sku,title,description,grant_gold,grant_diamonds,price_irr,active,sort_order,created_at,updated_at)
            VALUES (?,?,?,?,?,?,1,?,?,?)
            """,
            [(*item, now, now) for item in products],
        )

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _invite_code(length: int = 8) -> str:
        return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(length))

    def _new_session(self, db: sqlite3.Connection, user_id: int) -> str:
        token = secrets.token_urlsafe(36)
        now = _now()
        db.execute(
            "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
            (self._token_hash(token), user_id, now + SESSION_SECONDS, now),
        )
        return token

    def register(self, email: str, username: str, password: str, referral_code: str = "") -> tuple[str, dict[str, Any]]:
        email = normalize_email(email)
        username, username_key = normalize_username(username)
        validate_password(password)
        now = _now()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                raise AccountError("این ایمیل قبلاً ثبت شده است")
            if db.execute("SELECT 1 FROM users WHERE username_key=?", (username_key,)).fetchone():
                raise AccountError("این نام کاربری قبلاً انتخاب شده است")
            referrer = None
            if referral_code:
                referrer = db.execute(
                    "SELECT id FROM users WHERE referral_code=? AND is_active=1",
                    (referral_code.strip().upper(),),
                ).fetchone()
            code = self._invite_code()
            while db.execute("SELECT 1 FROM users WHERE referral_code=?", (code,)).fetchone():
                code = self._invite_code()
            starting_gold = ECONOMY_RULES["signup_gold"] + (ECONOMY_RULES["referral_gold_each"] if referrer else 0)
            cursor = db.execute(
                """
                INSERT INTO users
                    (email,username,username_key,password_hash,referral_code,referred_by,gold,created_at,last_seen)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (email, username, username_key, hash_password(password), code, referrer["id"] if referrer else None, starting_gold, now, now),
            )
            user_id = int(cursor.lastrowid)
            db.execute(
                "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                (user_id, "gold", ECONOMY_RULES["signup_gold"], "signup", f"signup:{user_id}", now),
            )
            if referrer:
                bonus = ECONOMY_RULES["referral_gold_each"]
                db.execute("UPDATE users SET gold=gold+? WHERE id=?", (bonus, referrer["id"]))
                db.execute(
                    "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                    (user_id, "gold", bonus, "referral_join", f"referral:{user_id}", now),
                )
                db.execute(
                    "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                    (referrer["id"], "gold", bonus, "referral_invite", f"invite:{user_id}", now),
                )
            token = self._new_session(db, user_id)
            db.commit()
        return token, self.get_user(user_id)

    def login(self, email: str, password: str) -> tuple[str, dict[str, Any]]:
        email = normalize_email(email)
        with self.connection() as db:
            row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if not row or not row["is_active"] or not verify_password(password, row["password_hash"]):
                raise AccountError("ایمیل یا رمز عبور اشتباه است")
            db.execute("BEGIN IMMEDIATE")
            token = self._new_session(db, int(row["id"]))
            db.execute("UPDATE users SET last_seen=? WHERE id=?", (_now(), row["id"]))
            db.commit()
        return token, self.get_user(int(row["id"]))

    def admin_login(self, identifier: str, password: str) -> tuple[str, dict[str, Any]]:
        normalized = unicodedata.normalize("NFKC", identifier).strip().casefold()
        if not normalized or len(normalized) > 254:
            raise AccountError("نام کاربری یا رمز عبور اشتباه است")
        with self.connection() as db:
            row = db.execute(
                "SELECT * FROM users WHERE email=? OR username_key=?",
                (normalized, normalized),
            ).fetchone()
            if (
                not row
                or not row["is_active"]
                or not row["is_admin"]
                or not verify_password(password, row["password_hash"])
            ):
                raise AccountError("نام کاربری یا رمز عبور اشتباه است")
            db.execute("BEGIN IMMEDIATE")
            token = self._new_session(db, int(row["id"]))
            db.execute("UPDATE users SET last_seen=? WHERE id=?", (_now(), row["id"]))
            db.commit()
        return token, self.get_user(int(row["id"]))

    def change_admin_password(self, user_id: int, current_password: str, new_password: str) -> tuple[str, dict[str, Any]]:
        validate_admin_password(new_password)
        now = _now()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            if not row or not row["is_active"] or not row["is_admin"]:
                raise AccountError("حساب مدیریت پیدا نشد")
            if not verify_password(current_password, row["password_hash"]):
                raise AccountError("رمز فعلی اشتباه است")
            if verify_password(new_password, row["password_hash"]):
                raise AccountError("رمز جدید باید با رمز فعلی متفاوت باشد")
            db.execute(
                "UPDATE users SET password_hash=?,must_change_password=0,password_changed_at=? WHERE id=?",
                (hash_password(new_password), now, user_id),
            )
            db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            token = self._new_session(db, user_id)
            self._audit(db, user_id, "admin_password_change", "user", str(user_id), "all_previous_sessions_revoked")
            db.commit()
        return token, self.get_user(user_id)

    def logout(self, token: str) -> None:
        if not token:
            return
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (self._token_hash(token),))

    def user_from_token(self, token: str) -> dict[str, Any] | None:
        if not token or len(token) > 256:
            return None
        now = _now()
        with self.connection() as db:
            row = db.execute(
                """
                SELECT u.* FROM sessions s
                JOIN users u ON u.id=s.user_id
                WHERE s.token_hash=? AND s.expires_at>? AND u.is_active=1
                """,
                (self._token_hash(token), now),
            ).fetchone()
            if not row:
                return None
            db.execute("UPDATE users SET last_seen=? WHERE id=?", (now, row["id"]))
            return self._user_dict(row, include_private=True, db=db)

    def get_user(self, user_id: int, include_private: bool = True) -> dict[str, Any]:
        with self.connection() as db:
            row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            if not row:
                raise AccountError("کاربر پیدا نشد")
            return self._user_dict(row, include_private=include_private, db=db)

    def _user_dict(self, row: sqlite3.Row, *, include_private: bool, db: sqlite3.Connection) -> dict[str, Any]:
        team = db.execute(
            """
            SELECT t.id,t.name,t.invite_code,t.owner_id FROM team_members tm
            JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=?
            """,
            (row["id"],),
        ).fetchone()
        payload: dict[str, Any] = {
            "id": int(row["id"]),
            "username": row["username"],
            "xp": int(row["xp"]),
            "rating": int(row["rating"]),
            "kills": int(row["kills"]),
            "wins": int(row["wins"]),
            "gamesPlayed": int(row["games_played"]),
            "bestPlayerCount": int(row["best_player_count"]),
            "rank": rank_for_xp(int(row["xp"])),
        }
        if include_private:
            payload.update({
                "email": row["email"],
                "referralCode": row["referral_code"],
                "isAdmin": bool(row["is_admin"]),
                "mustChangePassword": bool(row["must_change_password"]),
                "passwordChangedAt": int(row["password_changed_at"]) if row["password_changed_at"] else None,
                "isActive": bool(row["is_active"]),
                "gold": int(row["gold"]),
                "diamonds": int(row["diamonds"]),
                "team": {
                    "id": int(team["id"]),
                    "name": team["name"],
                    "inviteCode": team["invite_code"],
                    "ownerId": int(team["owner_id"]),
                } if team else None,
            })
        return payload

    def create_password_reset(self, email: str) -> tuple[str, dict[str, Any]] | None:
        try:
            email = normalize_email(email)
        except AccountError:
            return None
        with self.connection() as db:
            user = db.execute("SELECT id,email,username FROM users WHERE email=? AND is_active=1", (email,)).fetchone()
            if not user:
                return None
            token = secrets.token_urlsafe(40)
            now = _now()
            db.execute("DELETE FROM password_resets WHERE user_id=? OR expires_at<?", (user["id"], now))
            db.execute(
                "INSERT INTO password_resets(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
                (self._token_hash(token), user["id"], now + RESET_SECONDS, now),
            )
            return token, dict(user)

    def reset_password(self, token: str, password: str) -> None:
        validate_password(password)
        now = _now()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT user_id FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
                (self._token_hash(token), now),
            ).fetchone()
            if not row:
                raise AccountError("لینک بازیابی نامعتبر یا منقضی شده است")
            db.execute(
                "UPDATE users SET password_hash=?,must_change_password=0,password_changed_at=? WHERE id=?",
                (hash_password(password), now, row["user_id"]),
            )
            db.execute("UPDATE password_resets SET used_at=? WHERE token_hash=?", (now, self._token_hash(token)))
            db.execute("DELETE FROM sessions WHERE user_id=?", (row["user_id"],))
            db.commit()

    def leaderboard(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connection() as db:
            rows = db.execute(
                """
                SELECT id,username,xp,rating,kills,wins,games_played,best_player_count
                FROM users WHERE is_active=1
                ORDER BY rating DESC,xp DESC,wins DESC,kills DESC LIMIT ?
                """,
                (max(1, min(limit, 100)),),
            ).fetchall()
            return [
                {
                    "position": index + 1,
                    "id": int(row["id"]),
                    "username": row["username"],
                    "xp": int(row["xp"]),
                    "rating": int(row["rating"]),
                    "kills": int(row["kills"]),
                    "wins": int(row["wins"]),
                    "gamesPlayed": int(row["games_played"]),
                    "bestPlayerCount": int(row["best_player_count"]),
                    "rank": rank_for_xp(int(row["xp"])),
                }
                for index, row in enumerate(rows)
            ]

    @staticmethod
    def _pair(first: int, second: int) -> tuple[int, int]:
        if first == second:
            raise AccountError("این عملیات برای حساب خودتان ممکن نیست")
        return min(first, second), max(first, second)

    def _blocked(self, db: sqlite3.Connection, first: int, second: int) -> bool:
        return bool(db.execute(
            "SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)",
            (first, second, second, first),
        ).fetchone())

    def search_users(self, user_id: int, query: str) -> list[dict[str, Any]]:
        query = unicodedata.normalize("NFKC", query).strip().casefold()
        if len(query) < 2:
            return []
        with self.connection() as db:
            rows = db.execute(
                "SELECT * FROM users WHERE id!=? AND is_active=1 AND username_key LIKE ? ORDER BY username_key LIMIT 20",
                (user_id, f"%{query}%"),
            ).fetchall()
            result = []
            for row in rows:
                if self._blocked(db, user_id, int(row["id"])):
                    continue
                low, high = self._pair(user_id, int(row["id"]))
                friendship = db.execute(
                    "SELECT status,requested_by FROM friendships WHERE user_low=? AND user_high=?",
                    (low, high),
                ).fetchone()
                item = self._user_dict(row, include_private=False, db=db)
                item["friendship"] = dict(friendship) if friendship else None
                result.append(item)
            return result

    def send_friend_request(self, user_id: int, username: str) -> dict[str, Any]:
        _display, username_key = normalize_username(username)
        now = _now()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            target = db.execute("SELECT id,username FROM users WHERE username_key=? AND is_active=1", (username_key,)).fetchone()
            if not target:
                raise AccountError("کاربر پیدا نشد")
            target_id = int(target["id"])
            low, high = self._pair(user_id, target_id)
            if self._blocked(db, user_id, target_id):
                raise AccountError("ارسال درخواست به این کاربر ممکن نیست")
            existing = db.execute("SELECT status,requested_by FROM friendships WHERE user_low=? AND user_high=?", (low, high)).fetchone()
            if existing and existing["status"] == "accepted":
                raise AccountError("این کاربر در فهرست دوستان شماست")
            if existing and existing["status"] == "pending":
                if int(existing["requested_by"]) == target_id:
                    db.execute(
                        "UPDATE friendships SET status='accepted',updated_at=? WHERE user_low=? AND user_high=?",
                        (now, low, high),
                    )
                    db.commit()
                    return {"status": "accepted", "username": target["username"]}
                raise AccountError("درخواست قبلاً ارسال شده است")
            db.execute(
                """
                INSERT INTO friendships(user_low,user_high,requested_by,status,created_at,updated_at)
                VALUES(?,?,?,'pending',?,?)
                ON CONFLICT(user_low,user_high) DO UPDATE SET
                    requested_by=excluded.requested_by,status='pending',updated_at=excluded.updated_at
                """,
                (low, high, user_id, now, now),
            )
            db.commit()
            return {"status": "pending", "username": target["username"]}

    def respond_friend_request(self, user_id: int, request_id: int, accept: bool) -> None:
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM friendships WHERE id=? AND status='pending'", (request_id,)).fetchone()
            if not row or int(row["requested_by"]) == user_id or user_id not in (int(row["user_low"]), int(row["user_high"])):
                raise AccountError("درخواست دوستی پیدا نشد")
            db.execute(
                "UPDATE friendships SET status=?,updated_at=? WHERE id=?",
                ("accepted" if accept else "rejected", _now(), request_id),
            )
            db.commit()

    def block_user(self, user_id: int, target_id: int) -> None:
        low, high = self._pair(user_id, target_id)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM users WHERE id=?", (target_id,)).fetchone():
                raise AccountError("کاربر پیدا نشد")
            db.execute(
                "INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)",
                (user_id, target_id, _now()),
            )
            db.execute("DELETE FROM friendships WHERE user_low=? AND user_high=?", (low, high))
            db.commit()

    def unblock_user(self, user_id: int, target_id: int) -> None:
        with self.connection() as db:
            db.execute("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?", (user_id, target_id))

    def social(self, user_id: int) -> dict[str, list[dict[str, Any]]]:
        with self.connection() as db:
            rows = db.execute(
                """
                SELECT f.*,u.id peer_id,u.username,u.xp,u.rating
                FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low=? THEN f.user_high ELSE f.user_low END
                WHERE (f.user_low=? OR f.user_high=?) AND f.status IN ('pending','accepted')
                ORDER BY f.updated_at DESC
                """,
                (user_id, user_id, user_id),
            ).fetchall()
            friends, received, sent = [], [], []
            for row in rows:
                item = {
                    "requestId": int(row["id"]),
                    "id": int(row["peer_id"]),
                    "username": row["username"],
                    "xp": int(row["xp"]),
                    "rating": int(row["rating"]),
                    "rank": rank_for_xp(int(row["xp"])),
                }
                if row["status"] == "accepted":
                    friends.append(item)
                elif int(row["requested_by"]) == user_id:
                    sent.append(item)
                else:
                    received.append(item)
            blocked_rows = db.execute(
                "SELECT u.id,u.username FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC",
                (user_id,),
            ).fetchall()
            return {
                "friends": friends,
                "received": received,
                "sent": sent,
                "blocked": [dict(row) for row in blocked_rows],
            }

    def create_team(self, user_id: int, name: str) -> dict[str, Any]:
        name = " ".join(unicodedata.normalize("NFKC", name).strip().split())[:24]
        if len(name) < 3:
            raise AccountError("نام تیم باید حداقل ۳ کاراکتر باشد")
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM team_members WHERE user_id=?", (user_id,)).fetchone():
                raise AccountError("ابتدا از تیم فعلی خارج شوید")
            code = self._invite_code(6)
            while db.execute("SELECT 1 FROM teams WHERE invite_code=?", (code,)).fetchone():
                code = self._invite_code(6)
            now = _now()
            cursor = db.execute(
                "INSERT INTO teams(name,owner_id,invite_code,created_at) VALUES(?,?,?,?)",
                (name, user_id, code, now),
            )
            team_id = int(cursor.lastrowid)
            db.execute("INSERT INTO team_members(team_id,user_id,joined_at) VALUES(?,?,?)", (team_id, user_id, now))
            db.commit()
        return self.team_for_user(user_id) or {}

    def join_team(self, user_id: int, invite_code: str) -> dict[str, Any]:
        code = invite_code.strip().upper()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM team_members WHERE user_id=?", (user_id,)).fetchone():
                raise AccountError("شما در حال حاضر عضو یک تیم هستید")
            team = db.execute("SELECT * FROM teams WHERE invite_code=?", (code,)).fetchone()
            if not team:
                raise AccountError("کد دعوت تیم نامعتبر است")
            count = db.execute("SELECT COUNT(*) count FROM team_members WHERE team_id=?", (team["id"],)).fetchone()["count"]
            if int(count) >= 6:
                raise AccountError("ظرفیت تیم تکمیل است")
            members = db.execute("SELECT user_id FROM team_members WHERE team_id=?", (team["id"],)).fetchall()
            if any(self._blocked(db, user_id, int(member["user_id"])) for member in members):
                raise AccountError("به‌دلیل تنظیمات مسدودسازی، عضویت ممکن نیست")
            db.execute("INSERT INTO team_members(team_id,user_id,joined_at) VALUES(?,?,?)", (team["id"], user_id, _now()))
            db.commit()
        return self.team_for_user(user_id) or {}

    def leave_team(self, user_id: int) -> None:
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            membership = db.execute(
                "SELECT tm.team_id,t.owner_id FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=?",
                (user_id,),
            ).fetchone()
            if not membership:
                return
            team_id = int(membership["team_id"])
            db.execute("DELETE FROM team_members WHERE user_id=?", (user_id,))
            remaining = db.execute(
                "SELECT user_id FROM team_members WHERE team_id=? ORDER BY joined_at,user_id LIMIT 1",
                (team_id,),
            ).fetchone()
            if not remaining:
                db.execute("DELETE FROM teams WHERE id=?", (team_id,))
            elif int(membership["owner_id"]) == user_id:
                db.execute("UPDATE teams SET owner_id=? WHERE id=?", (remaining["user_id"], team_id))
            db.commit()

    def team_for_user(self, user_id: int) -> dict[str, Any] | None:
        with self.connection() as db:
            team = db.execute(
                """
                SELECT t.* FROM team_members tm JOIN teams t ON t.id=tm.team_id
                WHERE tm.user_id=?
                """,
                (user_id,),
            ).fetchone()
            if not team:
                return None
            members = db.execute(
                """
                SELECT u.id,u.username,u.xp,u.rating,tm.joined_at
                FROM team_members tm JOIN users u ON u.id=tm.user_id
                WHERE tm.team_id=? ORDER BY tm.joined_at
                """,
                (team["id"],),
            ).fetchall()
            return {
                "id": int(team["id"]),
                "name": team["name"],
                "ownerId": int(team["owner_id"]),
                "inviteCode": team["invite_code"],
                "members": [
                    {
                        "id": int(member["id"]),
                        "username": member["username"],
                        "rating": int(member["rating"]),
                        "rank": rank_for_xp(int(member["xp"])),
                    }
                    for member in members
                ],
                "maxMembers": 6,
            }

    def products(self, include_inactive: bool = False) -> list[dict[str, Any]]:
        with self.connection() as db:
            where = "" if include_inactive else "WHERE active=1"
            rows = db.execute(
                f"SELECT * FROM shop_products {where} ORDER BY sort_order,id"  # noqa: S608 - static fragment
            ).fetchall()
            return [self._product_dict(row) for row in rows]

    @staticmethod
    def _product_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "sku": row["sku"],
            "title": row["title"],
            "description": row["description"],
            "grantGold": int(row["grant_gold"]),
            "grantDiamonds": int(row["grant_diamonds"]),
            "priceIrr": int(row["price_irr"]),
            "active": bool(row["active"]),
            "sortOrder": int(row["sort_order"]),
        }

    def create_order(self, user_id: int, product_id: int) -> dict[str, Any]:
        with self.connection() as db:
            product = db.execute("SELECT * FROM shop_products WHERE id=? AND active=1", (product_id,)).fetchone()
            if not product:
                raise AccountError("بسته فروشگاه پیدا نشد")
            cursor = db.execute(
                "INSERT INTO purchase_orders(user_id,product_id,amount_irr,created_at) VALUES(?,?,?,?)",
                (user_id, product_id, product["price_irr"], _now()),
            )
            return self._order_by_id(db, int(cursor.lastrowid))

    def _order_by_id(self, db: sqlite3.Connection, order_id: int) -> dict[str, Any]:
        row = db.execute(
            """
            SELECT o.*,p.title,p.grant_gold,p.grant_diamonds,u.username
            FROM purchase_orders o JOIN shop_products p ON p.id=o.product_id
            JOIN users u ON u.id=o.user_id WHERE o.id=?
            """,
            (order_id,),
        ).fetchone()
        if not row:
            raise AccountError("سفارش پیدا نشد")
        return {
            "id": int(row["id"]),
            "userId": int(row["user_id"]),
            "username": row["username"],
            "productId": int(row["product_id"]),
            "title": row["title"],
            "grantGold": int(row["grant_gold"]),
            "grantDiamonds": int(row["grant_diamonds"]),
            "amountIrr": int(row["amount_irr"]),
            "status": row["status"],
            "trackingCode": row["tracking_code"],
            "createdAt": int(row["created_at"]),
        }

    def orders(self, user_id: int | None = None) -> list[dict[str, Any]]:
        with self.connection() as db:
            if user_id is None:
                ids = db.execute("SELECT id FROM purchase_orders ORDER BY created_at DESC LIMIT 200").fetchall()
            else:
                ids = db.execute("SELECT id FROM purchase_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (user_id,)).fetchall()
            return [self._order_by_id(db, int(row["id"])) for row in ids]

    def review_order(self, admin_id: int, order_id: int, approve: bool, tracking_code: str = "") -> dict[str, Any]:
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                """
                SELECT o.*,p.grant_gold,p.grant_diamonds FROM purchase_orders o
                JOIN shop_products p ON p.id=o.product_id WHERE o.id=?
                """,
                (order_id,),
            ).fetchone()
            if not row:
                raise AccountError("سفارش پیدا نشد")
            if row["status"] != "pending":
                raise AccountError("این سفارش قبلاً بررسی شده است")
            status = "paid" if approve else "rejected"
            now = _now()
            db.execute(
                "UPDATE purchase_orders SET status=?,tracking_code=?,reviewed_by=?,reviewed_at=? WHERE id=?",
                (status, tracking_code[:80] or None, admin_id, now, order_id),
            )
            if approve:
                gold, diamonds = int(row["grant_gold"]), int(row["grant_diamonds"])
                db.execute("UPDATE users SET gold=gold+?,diamonds=diamonds+? WHERE id=?", (gold, diamonds, row["user_id"]))
                if gold:
                    db.execute(
                        "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                        (row["user_id"], "gold", gold, "shop_order", f"order:{order_id}", now),
                    )
                if diamonds:
                    db.execute(
                        "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                        (row["user_id"], "diamonds", diamonds, "shop_order", f"order:{order_id}", now),
                    )
            self._audit(db, admin_id, "order_review", "order", str(order_id), f"status={status},tracking={tracking_code[:80]}")
            db.commit()
            return self._order_by_id(db, order_id)

    def save_product(self, product: dict[str, Any], product_id: int | None = None, admin_id: int | None = None) -> dict[str, Any]:
        title = " ".join(str(product.get("title", "")).strip().split())[:80]
        sku = re.sub(r"[^a-z0-9-]", "", str(product.get("sku", "")).strip().casefold())[:40]
        if not title or not sku:
            raise AccountError("عنوان و کد محصول الزامی است")
        values = (
            sku,
            title,
            str(product.get("description", ""))[:300],
            max(0, int(product.get("grantGold", 0))),
            max(0, int(product.get("grantDiamonds", 0))),
            max(0, int(product.get("priceIrr", 0))),
            1 if product.get("active", True) else 0,
            int(product.get("sortOrder", 0)),
        )
        with self.connection() as db:
            try:
                if product_id is None:
                    cursor = db.execute(
                        """
                        INSERT INTO shop_products
                            (sku,title,description,grant_gold,grant_diamonds,price_irr,active,sort_order,created_at,updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?)
                        """,
                        (*values, _now(), _now()),
                    )
                    product_id = int(cursor.lastrowid)
                else:
                    cursor = db.execute(
                        """
                        UPDATE shop_products SET sku=?,title=?,description=?,grant_gold=?,grant_diamonds=?,
                            price_irr=?,active=?,sort_order=?,updated_at=? WHERE id=?
                        """,
                        (*values, _now(), product_id),
                    )
                    if not cursor.rowcount:
                        raise AccountError("محصول پیدا نشد")
            except sqlite3.IntegrityError as exc:
                raise AccountError("کد محصول تکراری است") from exc
            if admin_id is not None:
                self._audit(db, admin_id, "save_product", "product", str(product_id), title)
            row = db.execute("SELECT * FROM shop_products WHERE id=?", (product_id,)).fetchone()
            return self._product_dict(row)

    def adjust_wallet(self, admin_id: int, user_id: int, gold: int, diamonds: int, reason: str) -> dict[str, Any]:
        reason = " ".join(reason.strip().split())[:120] or "admin_adjustment"
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT gold,diamonds FROM users WHERE id=?", (user_id,)).fetchone()
            if not row:
                raise AccountError("کاربر پیدا نشد")
            if int(row["gold"]) + gold < 0 or int(row["diamonds"]) + diamonds < 0:
                raise AccountError("موجودی نمی‌تواند منفی شود")
            db.execute("UPDATE users SET gold=gold+?,diamonds=diamonds+? WHERE id=?", (gold, diamonds, user_id))
            reference = f"admin:{admin_id}:{user_id}:{_now()}:{secrets.token_hex(3)}"
            if gold:
                db.execute(
                    "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                    (user_id, "gold", gold, reason, reference, _now()),
                )
            if diamonds:
                db.execute(
                    "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                    (user_id, "diamonds", diamonds, reason, reference, _now()),
                )
            self._audit(db, admin_id, "wallet_adjust", "user", str(user_id), f"gold={gold},diamonds={diamonds},reason={reason}")
            db.commit()
        return self.get_user(user_id)

    @staticmethod
    def _audit(db: sqlite3.Connection, admin_id: int, action: str, target_type: str, target_id: str, detail: str = "") -> None:
        db.execute(
            "INSERT INTO admin_audit(admin_id,action,target_type,target_id,detail,created_at) VALUES(?,?,?,?,?,?)",
            (admin_id, action[:60], target_type[:40], target_id[:80], detail[:500], _now()),
        )

    def set_user_status(self, admin_id: int, user_id: int, *, active: bool | None = None, admin: bool | None = None) -> dict[str, Any]:
        if admin_id == user_id and (active is False or admin is False):
            raise AccountError("نمی‌توانید دسترسی حساب مدیریتی خودتان را حذف کنید")
        updates: list[str] = []
        values: list[Any] = []
        if active is not None:
            updates.append("is_active=?")
            values.append(int(active))
        if admin is not None:
            updates.append("is_admin=?")
            values.append(int(admin))
        if not updates:
            return self.get_user(user_id)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            cursor = db.execute(f"UPDATE users SET {','.join(updates)} WHERE id=?", (*values, user_id))
            if not cursor.rowcount:
                raise AccountError("کاربر پیدا نشد")
            if active is False:
                db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            self._audit(db, admin_id, "user_status", "user", str(user_id), f"active={active},admin={admin}")
            db.commit()
        return self.get_user(user_id)

    def admin_users(self, query: str = "") -> list[dict[str, Any]]:
        normalized = query.strip().casefold()
        with self.connection() as db:
            if normalized:
                rows = db.execute(
                    "SELECT * FROM users WHERE email LIKE ? OR username_key LIKE ? ORDER BY id DESC LIMIT 100",
                    (f"%{normalized}%", f"%{normalized}%"),
                ).fetchall()
            else:
                rows = db.execute("SELECT * FROM users ORDER BY id DESC LIMIT 100").fetchall()
            return [self._user_dict(row, include_private=True, db=db) for row in rows]

    def admin_stats(self) -> dict[str, int]:
        with self.connection() as db:
            users = int(db.execute("SELECT COUNT(*) count FROM users").fetchone()["count"])
            orders = int(db.execute("SELECT COUNT(*) count FROM purchase_orders WHERE status='pending'").fetchone()["count"])
            gold = int(db.execute("SELECT COALESCE(SUM(gold),0) total FROM users").fetchone()["total"])
            diamonds = int(db.execute("SELECT COALESCE(SUM(diamonds),0) total FROM users").fetchone()["total"])
            games = int(db.execute("SELECT COUNT(DISTINCT round_id) count FROM match_results").fetchone()["count"])
            ads = int(db.execute("SELECT COUNT(*) count FROM advertisements WHERE active=1").fetchone()["count"])
            return {"users": users, "pendingOrders": orders, "gold": gold, "diamonds": diamonds, "rounds": games, "activeAds": ads}

    def audit_logs(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connection() as db:
            rows = db.execute(
                """
                SELECT a.*,u.username FROM admin_audit a JOIN users u ON u.id=a.admin_id
                ORDER BY a.id DESC LIMIT ?
                """,
                (max(1, min(limit, 500)),),
            ).fetchall()
            return [
                {
                    "id": int(row["id"]), "admin": row["username"], "action": row["action"],
                    "targetType": row["target_type"], "targetId": row["target_id"],
                    "detail": row["detail"], "createdAt": int(row["created_at"]),
                }
                for row in rows
            ]

    def promote_admin(self, email: str) -> dict[str, Any]:
        email = normalize_email(email)
        with self.connection() as db:
            cursor = db.execute("UPDATE users SET is_admin=1 WHERE email=?", (email,))
            if not cursor.rowcount:
                raise AccountError("ابتدا با این ایمیل ثبت‌نام کنید")
            row = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        return self.get_user(int(row["id"]))

    def create_admin(self, email: str, username: str, password: str, *, force_password_change: bool = True) -> dict[str, Any]:
        email = normalize_email(email)
        username, username_key = normalize_username(username)
        validate_admin_password(password)
        now = _now()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                raise AccountError("حسابی با این ایمیل وجود دارد")
            if db.execute("SELECT 1 FROM users WHERE username_key=?", (username_key,)).fetchone():
                raise AccountError("این نام کاربری قبلاً انتخاب شده است")
            code = self._invite_code()
            while db.execute("SELECT 1 FROM users WHERE referral_code=?", (code,)).fetchone():
                code = self._invite_code()
            cursor = db.execute(
                """
                INSERT INTO users
                    (email,username,username_key,password_hash,referral_code,is_admin,must_change_password,
                     password_changed_at,gold,created_at,last_seen)
                VALUES (?,?,?,?,?,1,?,?,0,?,?)
                """,
                (
                    email,
                    username,
                    username_key,
                    hash_password(password),
                    code,
                    int(force_password_change),
                    None if force_password_change else now,
                    now,
                    now,
                ),
            )
            user_id = int(cursor.lastrowid)
            self._audit(db, user_id, "admin_account_created", "user", str(user_id), f"force_change={force_password_change}")
            db.commit()
        return self.get_user(user_id)

    def advertisements(self, placement: str | None = None, include_inactive: bool = False) -> list[dict[str, Any]]:
        now = _now()
        clauses: list[str] = []
        values: list[Any] = []
        if not include_inactive:
            clauses.extend(["active=1", "(starts_at IS NULL OR starts_at<=?)", "(ends_at IS NULL OR ends_at>=?)"])
            values.extend([now, now])
        if placement:
            clauses.append("placement=?")
            values.append(placement)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connection() as db:
            rows = db.execute(
                f"SELECT * FROM advertisements {where} ORDER BY sort_order,id DESC LIMIT 50",  # noqa: S608 - static clauses
                values,
            ).fetchall()
            return [
                {
                    "id": int(row["id"]),
                    "title": row["title"],
                    "body": row["body"],
                    "imageUrl": row["image_url"],
                    "targetUrl": row["target_url"],
                    "placement": row["placement"],
                    "active": bool(row["active"]),
                    "startsAt": row["starts_at"],
                    "endsAt": row["ends_at"],
                    "sortOrder": int(row["sort_order"]),
                }
                for row in rows
            ]

    def save_advertisement(self, admin_id: int, data: dict[str, Any], ad_id: int | None = None) -> dict[str, Any]:
        title = " ".join(str(data.get("title", "")).strip().split())[:100]
        if not title:
            raise AccountError("عنوان تبلیغ الزامی است")
        placement = str(data.get("placement", "lobby"))
        if placement not in {"login", "lobby", "result"}:
            raise AccountError("جایگاه تبلیغ نامعتبر است")
        image_url = str(data.get("imageUrl", "")).strip()[:500]
        target_url = str(data.get("targetUrl", "")).strip()[:500]
        for url in (image_url, target_url):
            if url and not url.startswith("https://"):
                raise AccountError("آدرس تبلیغ باید با https:// شروع شود")
        values = (
            title,
            str(data.get("body", ""))[:500],
            image_url,
            target_url,
            placement,
            1 if data.get("active", True) else 0,
            int(data["startsAt"]) if data.get("startsAt") else None,
            int(data["endsAt"]) if data.get("endsAt") else None,
            int(data.get("sortOrder", 0)),
        )
        now = _now()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if ad_id is None:
                cursor = db.execute(
                    """
                    INSERT INTO advertisements
                        (title,body,image_url,target_url,placement,active,starts_at,ends_at,sort_order,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (*values, now, now),
                )
                ad_id = int(cursor.lastrowid)
            else:
                cursor = db.execute(
                    """
                    UPDATE advertisements SET title=?,body=?,image_url=?,target_url=?,placement=?,active=?,
                        starts_at=?,ends_at=?,sort_order=?,updated_at=? WHERE id=?
                    """,
                    (*values, now, ad_id),
                )
                if not cursor.rowcount:
                    raise AccountError("تبلیغ پیدا نشد")
            self._audit(db, admin_id, "save_ad", "advertisement", str(ad_id), title)
            db.commit()
        return next(item for item in self.advertisements(include_inactive=True) if item["id"] == ad_id)

    def record_match(self, round_id: str, room_code: str, map_id: str, results: list[dict[str, Any]]) -> None:
        now = _now()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            for result in results:
                user_id = int(result["user_id"])
                kills = max(0, int(result.get("kills", 0)))
                won = bool(result.get("won", False))
                xp = ECONOMY_RULES["participation_xp"] + kills * ECONOMY_RULES["kill_xp"]
                gold = ECONOMY_RULES["participation_gold"] + kills * ECONOMY_RULES["kill_gold"]
                diamonds = 0
                if won:
                    xp += ECONOMY_RULES["winner_xp"]
                    gold += ECONOMY_RULES["winner_gold"]
                    diamonds += ECONOMY_RULES["winner_diamonds"]
                cursor = db.execute(
                    """
                    INSERT OR IGNORE INTO match_results
                        (round_id,room_code,map_id,user_id,kills,won,xp_awarded,gold_awarded,diamonds_awarded,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?)
                    """,
                    (round_id, room_code, map_id, user_id, kills, int(won), xp, gold, diamonds, now),
                )
                if not cursor.rowcount:
                    continue
                rating_delta = kills * 8 + (50 if won else 0)
                db.execute(
                    """
                    UPDATE users SET xp=xp+?,gold=gold+?,diamonds=diamonds+?,rating=rating+?,
                        kills=kills+?,wins=wins+?,games_played=games_played+1,best_player_count=best_player_count+?
                    WHERE id=?
                    """,
                    (xp, gold, diamonds, rating_delta, kills, int(won), int(won), user_id),
                )
                if gold:
                    db.execute(
                        "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                        (user_id, "gold", gold, "match_reward", f"match:{round_id}", now),
                    )
                if diamonds:
                    db.execute(
                        "INSERT INTO currency_ledger(user_id,currency,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)",
                        (user_id, "diamonds", diamonds, "match_reward", f"match:{round_id}", now),
                    )
            db.commit()


def send_reset_email(recipient: str, username: str, reset_url: str) -> bool:
    host = os.environ.get("NEON_SMTP_HOST", "").strip()
    if not host:
        return False
    port = int(os.environ.get("NEON_SMTP_PORT", "587"))
    user = os.environ.get("NEON_SMTP_USER", "")
    password = os.environ.get("NEON_SMTP_PASSWORD", "")
    sender = os.environ.get("NEON_SMTP_FROM", user or f"no-reply@{host}")
    message = EmailMessage()
    message["Subject"] = "بازیابی رمز عبور نبرد نئون"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(f"سلام {username}\n\nبرای انتخاب رمز جدید از این لینک استفاده کنید:\n{reset_url}\n\nاین لینک ۳۰ دقیقه معتبر است.")
    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=15) as smtp:
            if user:
                smtp.login(user, password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls(context=context)
            if user:
                smtp.login(user, password)
            smtp.send_message(message)
    return True

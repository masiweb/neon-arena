from __future__ import annotations

import asyncio
import json
import os
import re
import smtplib
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .database import AccountError, Database, ECONOMY_RULES, send_reset_email
from .game import GameHub


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
ROOM_RE = re.compile(r"^[A-HJ-NP-Z2-9]{4}$")
GAME_VERSION = "3.0.0"
PROTOCOL_VERSION = "8"
PUBLIC_ORIGIN = os.environ.get("NEON_PUBLIC_ORIGIN", "https://game.chanelchat.ir").rstrip("/")

database = Database()
hub = GameHub(match_recorder=database.record_match)
app = FastAPI(title="Neon Arena", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", PUBLIC_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class RegisterBody(BaseModel):
    email: str = Field(max_length=254)
    username: str = Field(max_length=30)
    password: str = Field(max_length=128)
    referralCode: str = Field(default="", max_length=20)


class LoginBody(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class ForgotBody(BaseModel):
    email: str = Field(max_length=254)


class ResetBody(BaseModel):
    token: str = Field(max_length=256)
    password: str = Field(max_length=128)


class FriendBody(BaseModel):
    username: str = Field(max_length=30)


class TeamBody(BaseModel):
    name: str = Field(max_length=40)


class JoinTeamBody(BaseModel):
    inviteCode: str = Field(max_length=20)


class OrderBody(BaseModel):
    productId: int


class ReviewOrderBody(BaseModel):
    approve: bool
    trackingCode: str = Field(default="", max_length=80)


class WalletBody(BaseModel):
    gold: int = Field(default=0, ge=-10_000_000, le=10_000_000)
    diamonds: int = Field(default=0, ge=-1_000_000, le=1_000_000)
    reason: str = Field(default="admin_adjustment", max_length=120)


class UserStatusBody(BaseModel):
    active: bool | None = None
    admin: bool | None = None


class ProductBody(BaseModel):
    sku: str = Field(max_length=40)
    title: str = Field(max_length=80)
    description: str = Field(default="", max_length=300)
    grantGold: int = Field(default=0, ge=0, le=100_000_000)
    grantDiamonds: int = Field(default=0, ge=0, le=10_000_000)
    priceIrr: int = Field(ge=0, le=10_000_000_000)
    active: bool = True
    sortOrder: int = Field(default=0, ge=-10_000, le=10_000)


class AdvertisementBody(BaseModel):
    title: str = Field(max_length=100)
    body: str = Field(default="", max_length=500)
    imageUrl: str = Field(default="", max_length=500)
    targetUrl: str = Field(default="", max_length=500)
    placement: str = Field(default="lobby", max_length=20)
    active: bool = True
    startsAt: int | None = None
    endsAt: int | None = None
    sortOrder: int = Field(default=0, ge=-10_000, le=10_000)


class SlidingLimiter:
    def __init__(self) -> None:
        self.events: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, *, limit: int, window: int) -> None:
        now = time.monotonic()
        bucket = self.events[key]
        while bucket and bucket[0] < now - window:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید")
        bucket.append(now)


auth_limiter = SlidingLimiter()


def fail(exc: AccountError, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail=str(exc))


def bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="ابتدا وارد حساب شوید")
    return authorization[7:].strip()


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    token = bearer_token(authorization)
    user = database.user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="نشست شما منقضی شده است؛ دوباره وارد شوید")
    return user


def current_admin(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if not user["isAdmin"]:
        raise HTTPException(status_code=403, detail="دسترسی مدیر لازم است")
    return user


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "")
    return (forwarded.split(",", 1)[0].strip() if forwarded else request.client.host if request.client else "unknown")[:80]


def clean_room(code: str) -> str:
    normalized = code.upper()
    if not ROOM_RE.fullmatch(normalized):
        raise HTTPException(status_code=404, detail="اتاق پیدا نشد")
    return normalized


def ice_servers() -> list[dict[str, Any]]:
    servers: list[dict[str, Any]] = [{"urls": ["stun:stun.l.google.com:19302"]}]
    turn_url = os.environ.get("NEON_TURN_URL", "").strip()
    if turn_url:
        item: dict[str, Any] = {"urls": [turn_url]}
        if os.environ.get("NEON_TURN_USERNAME"):
            item["username"] = os.environ["NEON_TURN_USERNAME"]
            item["credential"] = os.environ.get("NEON_TURN_CREDENTIAL", "")
        servers.append(item)
    return servers


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "version": GAME_VERSION, "protocol": PROTOCOL_VERSION, **hub.stats()}


@app.get("/api/config")
async def config() -> dict[str, Any]:
    return {
        "version": GAME_VERSION,
        "protocol": PROTOCOL_VERSION,
        "publicOrigin": PUBLIC_ORIGIN,
        "emailResetConfigured": bool(os.environ.get("NEON_SMTP_HOST")),
        "paymentMode": "manual",
        "iceServers": ice_servers(),
    }


@app.post("/api/auth/register")
async def register(body: RegisterBody, request: Request) -> dict[str, Any]:
    auth_limiter.check(f"register:{client_ip(request)}", limit=8, window=600)
    try:
        token, user = await asyncio.to_thread(database.register, body.email, body.username, body.password, body.referralCode)
        return {"token": token, "user": user}
    except AccountError as exc:
        raise fail(exc) from exc


@app.post("/api/auth/login")
async def login(body: LoginBody, request: Request) -> dict[str, Any]:
    auth_limiter.check(f"login:{client_ip(request)}", limit=12, window=300)
    try:
        token, user = await asyncio.to_thread(database.login, body.email, body.password)
        return {"token": token, "user": user}
    except AccountError as exc:
        raise fail(exc, 401) from exc


@app.post("/api/auth/logout")
async def logout(authorization: str | None = Header(default=None)) -> dict[str, bool]:
    await asyncio.to_thread(database.logout, bearer_token(authorization))
    return {"ok": True}


@app.post("/api/auth/forgot")
async def forgot_password(body: ForgotBody, request: Request) -> dict[str, Any]:
    auth_limiter.check(f"forgot:{client_ip(request)}", limit=5, window=900)
    result = await asyncio.to_thread(database.create_password_reset, body.email)
    delivery = "email" if os.environ.get("NEON_SMTP_HOST") else "not_configured"
    response: dict[str, Any] = {"ok": True, "delivery": delivery, "message": "اگر این ایمیل ثبت شده باشد، راهنمای بازیابی ارسال می‌شود."}
    if result:
        token, user = result
        reset_url = f"{PUBLIC_ORIGIN}/#reset={token}"
        if os.environ.get("NEON_SMTP_HOST"):
            try:
                sent = await asyncio.to_thread(send_reset_email, user["email"], user["username"], reset_url)
                if not sent:
                    response["delivery"] = "failed"
            except (OSError, smtplib.SMTPException):
                response["delivery"] = "failed"
        elif os.environ.get("NEON_DEV_RESET") == "1":
            response["debugResetUrl"] = reset_url
    return response


@app.post("/api/auth/reset")
async def reset_password(body: ResetBody, request: Request) -> dict[str, bool]:
    auth_limiter.check(f"reset:{client_ip(request)}", limit=8, window=900)
    try:
        await asyncio.to_thread(database.reset_password, body.token, body.password)
        return {"ok": True}
    except AccountError as exc:
        raise fail(exc) from exc


@app.get("/api/me")
async def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": user, "inviteUrl": f"{PUBLIC_ORIGIN}/?ref={user['referralCode']}"}


@app.get("/api/leaderboard")
async def leaderboard(limit: int = Query(default=50, ge=1, le=100)) -> dict[str, Any]:
    return {"players": await asyncio.to_thread(database.leaderboard, limit)}


@app.get("/api/economy/rules")
async def economy_rules() -> dict[str, Any]:
    return {"rules": ECONOMY_RULES}


@app.get("/api/ads")
async def ads(placement: str = Query(default="lobby", pattern="^(login|lobby|result)$")) -> dict[str, Any]:
    return {"ads": await asyncio.to_thread(database.advertisements, placement)}


@app.get("/api/users/search")
async def search_users(q: str = Query(default="", max_length=30), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"users": await asyncio.to_thread(database.search_users, user["id"], q)}


@app.get("/api/friends")
async def friends(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return await asyncio.to_thread(database.social, user["id"])


@app.post("/api/friends/requests")
async def friend_request(body: FriendBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(database.send_friend_request, user["id"], body.username)
    except AccountError as exc:
        raise fail(exc) from exc


@app.post("/api/friends/requests/{request_id}/accept")
async def accept_friend(request_id: int, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    try:
        await asyncio.to_thread(database.respond_friend_request, user["id"], request_id, True)
        return {"ok": True}
    except AccountError as exc:
        raise fail(exc) from exc


@app.post("/api/friends/requests/{request_id}/reject")
async def reject_friend(request_id: int, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    try:
        await asyncio.to_thread(database.respond_friend_request, user["id"], request_id, False)
        return {"ok": True}
    except AccountError as exc:
        raise fail(exc) from exc


@app.post("/api/users/{target_id}/block")
async def block_user(target_id: int, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    try:
        await asyncio.to_thread(database.block_user, user["id"], target_id)
        return {"ok": True}
    except AccountError as exc:
        raise fail(exc) from exc


@app.delete("/api/users/{target_id}/block")
async def unblock_user(target_id: int, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    await asyncio.to_thread(database.unblock_user, user["id"], target_id)
    return {"ok": True}


@app.get("/api/teams/me")
async def my_team(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    team = await asyncio.to_thread(database.team_for_user, user["id"])
    return {"team": team, "inviteUrl": f"{PUBLIC_ORIGIN}/?team={team['inviteCode']}" if team else None}


@app.post("/api/teams")
async def create_team(body: TeamBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    try:
        team = await asyncio.to_thread(database.create_team, user["id"], body.name)
        return {"team": team, "inviteUrl": f"{PUBLIC_ORIGIN}/?team={team['inviteCode']}"}
    except AccountError as exc:
        raise fail(exc) from exc


@app.post("/api/teams/join")
async def join_team(body: JoinTeamBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    try:
        return {"team": await asyncio.to_thread(database.join_team, user["id"], body.inviteCode)}
    except AccountError as exc:
        raise fail(exc) from exc


@app.post("/api/teams/leave")
async def leave_team(user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    await asyncio.to_thread(database.leave_team, user["id"])
    return {"ok": True}


@app.get("/api/shop/products")
async def shop_products() -> dict[str, Any]:
    return {"products": await asyncio.to_thread(database.products)}


@app.get("/api/shop/orders")
async def my_orders(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"orders": await asyncio.to_thread(database.orders, user["id"])}


@app.post("/api/shop/orders")
async def create_order(body: OrderBody, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    try:
        order = await asyncio.to_thread(database.create_order, user["id"], body.productId)
        return {"order": order, "paymentMode": "manual", "message": "سفارش ثبت شد و پس از تأیید مدیر به کیف پول اضافه می‌شود."}
    except AccountError as exc:
        raise fail(exc) from exc


@app.post("/api/rooms")
async def create_room(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    room, reused = hub.create_room(owner_user_id=user["id"])
    return {"code": room.code, "reused": reused, "inviteUrl": f"{PUBLIC_ORIGIN}/?room={room.code}"}


@app.get("/api/rooms/{code}")
async def room_info(code: str) -> dict[str, object]:
    room = hub.get_room(clean_room(code))
    if not room:
        raise HTTPException(status_code=404, detail="اتاق پیدا نشد")
    return {"code": room.code, "players": len(room.players), "phase": room.phase, "map": room.map_id}


@app.post("/api/rooms/{code}/leave")
async def leave_room(code: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    room = hub.get_room(clean_room(code))
    if room:
        await room.remove_account(user["id"])
    return {"ok": True}


@app.get("/api/admin/stats")
async def admin_stats(_admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    return {**(await asyncio.to_thread(database.admin_stats)), "onlineRooms": hub.stats()["rooms"], "onlinePlayers": hub.stats()["players"]}


@app.get("/api/admin/users")
async def admin_users(q: str = Query(default="", max_length=100), _admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    return {"users": await asyncio.to_thread(database.admin_users, q)}


@app.patch("/api/admin/users/{user_id}")
async def admin_user_status(user_id: int, body: UserStatusBody, admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    try:
        return {"user": await asyncio.to_thread(database.set_user_status, admin["id"], user_id, active=body.active, admin=body.admin)}
    except AccountError as exc:
        raise fail(exc) from exc


@app.post("/api/admin/users/{user_id}/wallet")
async def admin_wallet(user_id: int, body: WalletBody, admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    try:
        return {"user": await asyncio.to_thread(database.adjust_wallet, admin["id"], user_id, body.gold, body.diamonds, body.reason)}
    except AccountError as exc:
        raise fail(exc) from exc


@app.get("/api/admin/orders")
async def admin_orders(_admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    return {"orders": await asyncio.to_thread(database.orders)}


@app.post("/api/admin/orders/{order_id}/review")
async def admin_review_order(order_id: int, body: ReviewOrderBody, admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    try:
        return {"order": await asyncio.to_thread(database.review_order, admin["id"], order_id, body.approve, body.trackingCode)}
    except AccountError as exc:
        raise fail(exc) from exc


@app.get("/api/admin/products")
async def admin_products(_admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    return {"products": await asyncio.to_thread(database.products, True)}


@app.post("/api/admin/products")
async def admin_create_product(body: ProductBody, admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    try:
        return {"product": await asyncio.to_thread(database.save_product, body.model_dump(), None, admin["id"])}
    except AccountError as exc:
        raise fail(exc) from exc


@app.patch("/api/admin/products/{product_id}")
async def admin_update_product(product_id: int, body: ProductBody, admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    try:
        return {"product": await asyncio.to_thread(database.save_product, body.model_dump(), product_id, admin["id"])}
    except AccountError as exc:
        raise fail(exc) from exc


@app.get("/api/admin/ads")
async def admin_ads(_admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    return {"ads": await asyncio.to_thread(database.advertisements, None, True)}


@app.get("/api/admin/audit")
async def admin_audit(limit: int = Query(default=100, ge=1, le=500), _admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    return {"logs": await asyncio.to_thread(database.audit_logs, limit)}


@app.post("/api/admin/ads")
async def admin_create_ad(body: AdvertisementBody, admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    try:
        return {"ad": await asyncio.to_thread(database.save_advertisement, admin["id"], body.model_dump())}
    except AccountError as exc:
        raise fail(exc) from exc


@app.patch("/api/admin/ads/{ad_id}")
async def admin_update_ad(ad_id: int, body: AdvertisementBody, admin: dict[str, Any] = Depends(current_admin)) -> dict[str, Any]:
    try:
        return {"ad": await asyncio.to_thread(database.save_advertisement, admin["id"], body.model_dump(), ad_id)}
    except AccountError as exc:
        raise fail(exc) from exc


@app.websocket("/ws/{code}")
async def game_socket(socket: WebSocket, code: str) -> None:
    normalized = code.upper()
    await socket.accept()
    if socket.query_params.get("protocol") != PROTOCOL_VERSION:
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
    user: dict[str, Any] | None = None
    try:
        raw_auth = await asyncio.wait_for(socket.receive_text(), timeout=6.0)
        auth_payload = json.loads(raw_auth)
        if not isinstance(auth_payload, dict) or auth_payload.get("type") != "auth":
            raise AccountError("ورود به حساب برای بازی الزامی است")
        user = await asyncio.to_thread(database.user_from_token, str(auth_payload.get("token", "")))
        if not user:
            raise AccountError("نشست شما منقضی شده است؛ دوباره وارد شوید")
        if not hub.claim_user(user["id"], normalized):
            raise AccountError("حساب شما هم‌اکنون در اتاق دیگری فعال است")
        player = await room.add_player(socket, await asyncio.to_thread(database.get_user, user["id"]), ice_servers())
        while True:
            raw = await socket.receive_text()
            if len(raw) > 8_000:
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                await room.handle(player, payload)
    except (AccountError, ValueError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
        await socket.send_json({"type": "error", "message": str(exc)})
        await socket.close(code=1008)
    except WebSocketDisconnect:
        pass
    finally:
        if player:
            await room.remove_player(player.id)
        if user:
            hub.release_user(user["id"], normalized)


@app.get("/admin")
async def admin_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "admin.html")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

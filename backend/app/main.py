import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import db, game
from .auth import current_user_id
from .config import settings

log = logging.getLogger("battle")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


async def income_loop() -> None:
    while True:
        try:
            async with db.get_pool().acquire() as conn:
                if await game.run_daily_income(conn):
                    log.info("Daily income granted")
        except Exception:
            log.exception("income loop failed")
        await asyncio.sleep(settings.income_check_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    task = asyncio.create_task(income_loop())
    yield
    task.cancel()
    await db.close_pool()


app = FastAPI(title="Битва Классов API", lifespan=lifespan)
if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(game.GameError)
async def game_error_handler(_, exc: game.GameError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


class RegisterIn(BaseModel):
    role: str
    class_id: int | None = None
    display_name: str = Field("", max_length=100)
    code: str | None = None


class GrantIn(BaseModel):
    amount: int
    note: str | None = None


@app.get("/api/health")
async def health():
    async with db.get_pool().acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok"}


@app.get("/api/institutions")
async def institutions():
    async with db.get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT id, name, address FROM educational_institutions ORDER BY id")
    return [dict(r) for r in rows]


@app.get("/api/institutions/{inst_id}/classes")
async def classes(inst_id: int):
    async with db.get_pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, grade_level, color FROM institution_classes WHERE institution_id=$1 ORDER BY grade_level, name",
            inst_id)
    return [dict(r) for r in rows]


@app.get("/api/me")
async def me(user_id: int = Depends(current_user_id)):
    async with db.get_pool().acquire() as conn:
        u = await game.get_user(conn, user_id)
    if not u:
        return {"registered": False, "user_id": user_id}
    return {"registered": True, **dict(u)}


@app.post("/api/register")
async def register(body: RegisterIn, user_id: int = Depends(current_user_id)):
    async with db.get_pool().acquire() as conn:
        await game.register(conn, user_id, body.role, body.class_id, body.display_name, body.code)
        u = await game.get_user(conn, user_id)
    return {"registered": True, **dict(u)}


@app.get("/api/institutions/{inst_id}/map")
async def get_map(inst_id: int):
    """Публичная карта (только игровые данные, без персональных)."""
    async with db.get_pool().acquire() as conn:
        await game.ensure_grid(conn, inst_id)
        inst = await conn.fetchrow(
            "SELECT id, name, latitude, longitude, outline_radius_m, hex_radius_m FROM educational_institutions WHERE id=$1",
            inst_id)
        cls = await conn.fetch(
            "SELECT id, name, color FROM institution_classes WHERE institution_id=$1 ORDER BY grade_level, name", inst_id)
        hexes = await conn.fetch(
            "SELECT id, q, r, lat, lng, owner_class_id, is_home, value, daily_points FROM map_hexes WHERE institution_id=$1",
            inst_id)
        board = await game.leaderboard(conn, inst_id)
    return {"institution": dict(inst), "classes": [dict(c) for c in cls],
            "hexes": [dict(h) for h in hexes], "leaderboard": board}


@app.get("/api/institutions/{inst_id}/leaderboard")
async def leaderboard(inst_id: int):
    async with db.get_pool().acquire() as conn:
        return await game.leaderboard(conn, inst_id)


@app.get("/api/hexes/{hex_id}/quote")
async def quote(hex_id: int, user_id: int = Depends(current_user_id)):
    async with db.get_pool().acquire() as conn:
        user = await game.get_user(conn, user_id)
        return await game.quote(conn, user, hex_id)


@app.post("/api/hexes/{hex_id}/capture")
async def capture(hex_id: int, user_id: int = Depends(current_user_id)):
    async with db.get_pool().acquire() as conn:
        return await game.capture(conn, user_id, hex_id)


@app.post("/api/classes/{class_id}/grant")
async def grant(class_id: int, body: GrantIn, user_id: int = Depends(current_user_id)):
    async with db.get_pool().acquire() as conn:
        balance = await game.grant(conn, user_id, class_id, body.amount, body.note)
    return {"ok": True, "balance": balance}


@app.post("/api/institutions/{inst_id}/reset")
async def reset(inst_id: int, user_id: int = Depends(current_user_id)):
    async with db.get_pool().acquire() as conn:
        u = await game.get_user(conn, user_id)
        if not u or u["role"] != "admin":
            raise HTTPException(403, "Только администратор")
        await game.reset_map(conn, inst_id)
    return {"ok": True}

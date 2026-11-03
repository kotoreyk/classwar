"""Операции над БД. Все изменения ОД и владельцев гексов — только здесь, только в транзакциях."""
import datetime
import hmac
import zoneinfo

import asyncpg

from . import hexgen, rules
from .config import settings


class GameError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


async def ensure_grid(conn: asyncpg.Connection, institution_id: int) -> None:
    """Ленивая генерация карты. advisory lock исключает дубли при одновременных первых запросах."""
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", 1000 + institution_id)
        inst = await conn.fetchrow("SELECT * FROM educational_institutions WHERE id=$1", institution_id)
        if not inst:
            raise GameError("Учреждение не найдено", 404)
        if inst["grid_generated"]:
            return
        classes = await conn.fetch("SELECT id FROM institution_classes WHERE institution_id=$1 ORDER BY id", institution_id)
        if not classes:
            raise GameError("В учреждении нет классов", 409)
        res = hexgen.generate((inst["latitude"], inst["longitude"]), inst["outline_radius_m"],
                              settings.hexes_per_class, [c["id"] for c in classes])
        await conn.executemany(
            """INSERT INTO map_hexes (institution_id,q,r,lat,lng,owner_class_id,is_home,value,daily_points)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
            [(institution_id, h["q"], h["r"], h["lat"], h["lng"], h["owner"], h["is_home"], h["value"], h["daily_points"])
             for h in res["hexes"]])
        await conn.execute("UPDATE educational_institutions SET hex_radius_m=$2, grid_generated=TRUE WHERE id=$1",
                           institution_id, res["radius"])


async def reset_map(conn: asyncpg.Connection, institution_id: int) -> None:
    """Пересоздать карту с нуля (админ). Баланс ОД не трогаем."""
    async with conn.transaction():
        await conn.execute("DELETE FROM map_hexes WHERE institution_id=$1", institution_id)
        await conn.execute("UPDATE educational_institutions SET grid_generated=FALSE, hex_radius_m=NULL WHERE id=$1",
                           institution_id)
    await ensure_grid(conn, institution_id)


async def get_user(conn: asyncpg.Connection, user_id: int):
    return await conn.fetchrow(
        """SELECT u.max_user_id, u.display_name, u.role, u.class_id,
                  c.name AS class_name, c.institution_id, c.ap_balance, c.color
           FROM app_users u LEFT JOIN institution_classes c ON c.id = u.class_id
           WHERE u.max_user_id=$1""", user_id)


def _code_ok(given: str, expected: str) -> bool:
    return bool(expected) and hmac.compare_digest(given.encode(), expected.encode())


async def register(conn: asyncpg.Connection, user_id: int, role: str, class_id: int | None,
                   display_name: str, code: str | None) -> None:
    if role in ("schoolboy", "student"):
        if not class_id or not await conn.fetchval("SELECT 1 FROM institution_classes WHERE id=$1", class_id):
            raise GameError("Выберите класс")
    elif role == "curator":
        if not _code_ok(code or "", settings.curator_code):
            raise GameError("Неверный код куратора", 403)
        class_id = None
    elif role == "admin":
        if not _code_ok(code or "", settings.admin_code):
            raise GameError("Неверный код администратора", 403)
        class_id = None
    else:
        raise GameError("Неизвестная роль")
    # Смена уже существующего admin/curator на игрока допустима; повышение — только с кодом (проверено выше).
    await conn.execute(
        """INSERT INTO app_users (max_user_id, display_name, role, class_id) VALUES ($1,$2,$3,$4)
           ON CONFLICT (max_user_id) DO UPDATE SET role=EXCLUDED.role, class_id=EXCLUDED.class_id,
                                                  display_name=EXCLUDED.display_name""",
        user_id, display_name[:100], role, class_id)


async def quote(conn: asyncpg.Connection, user, hex_id: int) -> dict:
    """Цена захвата для класса пользователя (без изменений в БД)."""
    if not user or not user["class_id"]:
        raise GameError("Только участники классов могут захватывать сектора", 403)
    h = await conn.fetchrow("SELECT * FROM map_hexes WHERE id=$1", hex_id)
    if not h:
        raise GameError("Сектор не найден", 404)
    return await _quote_for(conn, user, h)


async def _quote_for(conn, user, h) -> dict:
    if h["institution_id"] != user["institution_id"]:
        raise GameError("Это сектор другого учреждения", 403)
    if h["owner_class_id"] == user["class_id"]:
        raise GameError("Сектор уже ваш")
    if h["is_home"]:
        raise GameError("Нельзя атаковать домашнюю территорию")
    owned = await conn.fetch("SELECT q, r FROM map_hexes WHERE institution_id=$1 AND owner_class_id=$2",
                             h["institution_id"], user["class_id"])
    d = rules.nearest_distance(h["q"], h["r"], [(o["q"], o["r"]) for o in owned])
    enemy = h["owner_class_id"] is not None
    return {"hex_id": h["id"], "distance": d, "enemy": enemy,
            "multiplier": round(rules.NEIGHBOR_PENALTY ** d * (rules.ENEMY_MULTIPLIER if enemy else 1), 2),
            "cost": rules.capture_cost(h["value"], d, enemy),
            "balance": user["ap_balance"]}


async def capture(conn: asyncpg.Connection, user_id: int, hex_id: int) -> dict:
    async with conn.transaction():
        user = await get_user(conn, user_id)
        if not user or not user["class_id"]:
            raise GameError("Только участники классов могут захватывать сектора", 403)
        h = await conn.fetchrow("SELECT * FROM map_hexes WHERE id=$1 FOR UPDATE", hex_id)
        if not h:
            raise GameError("Сектор не найден", 404)
        cls = await conn.fetchrow("SELECT ap_balance FROM institution_classes WHERE id=$1 FOR UPDATE", user["class_id"])
        user = dict(user, ap_balance=cls["ap_balance"])
        q = await _quote_for(conn, user, h)
        if cls["ap_balance"] < q["cost"]:
            raise GameError(f"Не хватает ОД: нужно {q['cost']}, у класса {cls['ap_balance']}", 409)
        await conn.execute("UPDATE institution_classes SET ap_balance = ap_balance - $2 WHERE id=$1",
                           user["class_id"], q["cost"])
        await conn.execute("UPDATE map_hexes SET owner_class_id=$2 WHERE id=$1", hex_id, user["class_id"])
        await conn.execute(
            "INSERT INTO ap_ledger (class_id, delta, reason, hex_id, actor_user_id) VALUES ($1,$2,'capture',$3,$4)",
            user["class_id"], -q["cost"], hex_id, user_id)
        return {"ok": True, "cost": q["cost"], "balance": cls["ap_balance"] - q["cost"]}


async def grant(conn: asyncpg.Connection, actor_id: int, class_id: int, amount: int, note: str | None) -> int:
    actor = await get_user(conn, actor_id)
    if not actor or actor["role"] not in ("curator", "admin"):
        raise GameError("Недостаточно прав", 403)
    if not (-10000 <= amount <= 10000) or amount == 0:
        raise GameError("Количество ОД должно быть ненулевым и не больше 10000 по модулю")
    async with conn.transaction():
        row = await conn.fetchrow("SELECT ap_balance FROM institution_classes WHERE id=$1 FOR UPDATE", class_id)
        if not row:
            raise GameError("Класс не найден", 404)
        new_balance = row["ap_balance"] + amount
        if new_balance < 0:
            raise GameError("Баланс не может быть отрицательным")
        await conn.execute("UPDATE institution_classes SET ap_balance=$2 WHERE id=$1", class_id, new_balance)
        await conn.execute(
            "INSERT INTO ap_ledger (class_id, delta, reason, actor_user_id, note) VALUES ($1,$2,'grant',$3,$4)",
            class_id, amount, actor_id, (note or "")[:200])
    return new_balance


async def run_daily_income(conn: asyncpg.Connection) -> bool:
    """Начисляет доход один раз в сутки (повторный вызов в тот же день ничего не делает)."""
    today = datetime.datetime.now(zoneinfo.ZoneInfo(settings.income_tz)).date()
    async with conn.transaction():
        inserted = await conn.fetchval(
            "INSERT INTO income_runs (run_date) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1", today)
        if not inserted:
            return False
        await conn.execute(
            """WITH inc AS (
                   SELECT owner_class_id AS cid, SUM(daily_points)::int AS pts
                   FROM map_hexes WHERE owner_class_id IS NOT NULL GROUP BY 1),
               upd AS (
                   UPDATE institution_classes c SET ap_balance = c.ap_balance + inc.pts
                   FROM inc WHERE c.id = inc.cid RETURNING c.id AS cid, inc.pts AS pts)
               INSERT INTO ap_ledger (class_id, delta, reason, note)
               SELECT cid, pts, 'daily_income', $1 FROM upd""", str(today))
    return True


async def leaderboard(conn: asyncpg.Connection, institution_id: int) -> list[dict]:
    rows = await conn.fetch(
        """SELECT c.id, c.name, c.color, c.ap_balance,
                  COUNT(h.id) AS hexes, COALESCE(SUM(h.daily_points),0) AS income
           FROM institution_classes c LEFT JOIN map_hexes h ON h.owner_class_id = c.id
           WHERE c.institution_id=$1 GROUP BY c.id ORDER BY hexes DESC, income DESC, c.name""", institution_id)
    return [dict(r) for r in rows]

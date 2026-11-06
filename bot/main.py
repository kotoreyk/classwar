"""Бот «Битва классов». Тонкий клиент: вся логика и данные — в backend (/api).
Секреты — только из окружения. Состояние диалога (ожидание кода/числа) — в памяти, это допустимо:
потеря при рестарте просто прерывает текущий диалог; роли и баланс хранятся в БД."""
import asyncio
import logging
import os

import httpx
from maxapi import Bot, Dispatcher, Command, InlineKeyboardBuilder
from maxapi.types import Message, CallbackPayload

TOKEN = os.getenv("BOT_TOKEN", "")
SERVICE_KEY = os.getenv("SERVICE_KEY", "")
if not TOKEN or not SERVICE_KEY:
    raise SystemExit("Задайте BOT_TOKEN и SERVICE_KEY в .env (см. .env.example)")
API_URL = os.getenv("API_URL", "http://backend:8000")
WEBAPP_URL = os.getenv("WEBAPP_URL", "")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
bot = Bot(token=TOKEN)
dp = Dispatcher()
http = httpx.AsyncClient(base_url=API_URL, timeout=10)

WELCOME_TEXT = (
    "👋 Привет! Добро пожаловать в Битву классов!\n\n"
    "Зарабатывай очки действия за учёбу и захватывай сектора карты своей школы для своего класса. 🏆\n\n"
    "Выбери действие:"
)
RULES_TEXT = (
    "📜 Правила:\n"
    "1. Куратор начисляет классу ОД за успехи в учёбе.\n"
    "2. Каждый сектор приносит классу ОД каждый день: чем ближе к центру, тем больше.\n"
    "3. Захват стоит ОД: чем дальше от ваших секторов — тем дороже; вражеские — на 50% дороже.\n"
    "4. Домашние сектора захватывать нельзя."
)
ROLE_LABELS = {"schoolboy": "🎒 Школьник", "student": "🎓 Студент", "curator": "🧑‍🏫 Куратор", "admin": "🛡️ Администратор"}

# (user_id) -> {"kind": "code", "role": ...} | {"kind": "grant", "class_id": ...}
states: dict[int, dict] = {}


async def api(method: str, path: str, user_id: int | None = None, **kw):
    headers = {"X-Service-Key": SERVICE_KEY}
    if user_id is not None:
        headers["X-Acting-User-Id"] = str(user_id)
    r = await http.request(method, path, headers=headers, **kw)
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail", r.text)
        except Exception:
            detail = r.text
        raise RuntimeError(str(detail))
    return r.json()


# ---- извлечение данных из событий (maxapi). Если ваша версия называет поля иначе — правим только здесь ----
def _dig(obj, *path):
    for p in path:
        obj = getattr(obj, p, None)
        if obj is None:
            return None
    return obj


def callback_user(event):
    """user_id нажавшего кнопку. НЕ sender сообщения — там автор сообщения, т.е. бот."""
    for path in (("callback", "user", "user_id"), ("user", "user_id"), ("from_user", "user_id")):
        v = _dig(event, *path)
        if v:
            return v, (_dig(event, "callback", "user", "name") or _dig(event, "callback", "user", "first_name") or "")
    return None, ""


def message_user(event):
    v = _dig(event, "message", "sender", "user_id") or _dig(event, "sender", "user_id")
    name = _dig(event, "message", "sender", "name") or _dig(event, "message", "sender", "first_name") or ""
    return v, name


def message_text(event) -> str:
    t = _dig(event, "message", "body", "text") or getattr(event, "text", None) or _dig(event, "message", "text")
    return (t or "").strip()


# ---- клавиатуры ----
def kb_start():
    b = InlineKeyboardBuilder()
    b.callback("📋 Меню", "menu")
    b.callback("❓ Правила", "rules")
    b.callback("🔑 Авторизация", "auth")
    b.adjust(2)
    return b


def kb_roles():
    b = InlineKeyboardBuilder()
    for key, label in ROLE_LABELS.items():
        b.callback(label, f"role:{key}")
    b.adjust(1)
    return b


def kb_menu(role: str | None):
    b = InlineKeyboardBuilder()
    b.callback("👤 Профиль", "profile")
    b.callback("🏆 Рейтинг", "board")
    if WEBAPP_URL:
        b.link("🗺️ Открыть карту", WEBAPP_URL)
    if role in ("curator", "admin"):
        b.callback("➕ Начислить ОД", "grant")
    b.callback("❓ Правила", "rules")
    b.adjust(2)
    return b


def kb_list(items, prefix, back="menu"):
    b = InlineKeyboardBuilder()
    for it in items:
        b.callback(it["name"], f"{prefix}:{it['id']}")
    b.callback("⬅️ Назад", back)
    b.adjust(1)
    return b


# ---- хендлеры ----
@dp.bot_started()
async def bot_started(event):
    try:
        await event.bot.send_message(chat_id=event.chat_id, text=WELCOME_TEXT, keyboard=kb_start())
    except Exception:
        logging.exception("bot_started")


@dp.message_created(Command("start"))
async def cmd_start(event: Message):
    await event.message.answer(WELCOME_TEXT, keyboard=kb_start())


async def show_menu(send, uid):
    me = await api("GET", "/api/me", uid)
    role = me.get("role") if me.get("registered") else None
    await send("📋 Главное меню:" if me.get("registered") else "Сначала пройдите авторизацию 👇",
               keyboard=kb_menu(role) if me.get("registered") else kb_start())


@dp.message_callback()
async def on_callback(event: CallbackPayload):
    try:
        payload = _dig(event, "callback", "payload") or getattr(event, "payload", "") or ""
        uid, name = callback_user(event)
        try:
            await event.answer(notification="…")
        except Exception:
            pass
        if not uid:
            logging.error("Не удалось определить user_id из callback — проверьте версию maxapi")
            return
        send = event.message.answer

        if payload == "menu":
            await show_menu(send, uid)
        elif payload == "rules":
            await send(RULES_TEXT)
        elif payload == "auth":
            await send("🔐 Кто вы?", keyboard=kb_roles())

        elif payload.startswith("role:"):
            role = payload.split(":", 1)[1]
            if role in ("curator", "admin"):
                states[uid] = {"kind": "code", "role": role, "name": name}
                await send(f"Введите код доступа ({ROLE_LABELS[role]}):")
            else:
                insts = await api("GET", "/api/institutions")
                states[uid] = {"kind": "reg", "role": role, "name": name}
                await send("Выберите учебное заведение:", keyboard=kb_list(insts, "inst", "auth"))

        elif payload.startswith("inst:"):
            st = states.get(uid)
            if not st or st.get("kind") != "reg":
                return await show_menu(send, uid)
            classes = await api("GET", f"/api/institutions/{payload.split(':')[1]}/classes")
            await send("Выберите свой класс:", keyboard=kb_list(classes, "cls", "auth"))

        elif payload.startswith("cls:"):
            st = states.pop(uid, None)
            if not st or st.get("kind") != "reg":
                return await show_menu(send, uid)
            me = await api("POST", "/api/register", uid,
                           json={"role": st["role"], "class_id": int(payload.split(":")[1]), "display_name": st["name"]})
            await send(f"✅ Готово! Роль: {ROLE_LABELS[me['role']]}, класс: {me['class_name']}", keyboard=kb_menu(me["role"]))

        elif payload == "profile":
            me = await api("GET", "/api/me", uid)
            if not me.get("registered"):
                return await send("Сначала пройдите авторизацию 👇", keyboard=kb_start())
            lines = [f"👤 {me['display_name'] or 'Игрок'}", f"Роль: {ROLE_LABELS[me['role']]}"]
            if me.get("class_name"):
                lines += [f"Класс: {me['class_name']}", f"ОД класса: {me['ap_balance']}"]
            await send("\n".join(lines), keyboard=kb_menu(me["role"]))

        elif payload == "board":
            me = await api("GET", "/api/me", uid)
            if not me.get("registered"):
                return await send("Сначала пройдите авторизацию 👇", keyboard=kb_start())
            inst_id = me.get("institution_id")
            if not inst_id:
                insts = await api("GET", "/api/institutions")
                return await send("Выберите учреждение:", keyboard=kb_list(insts, "boardinst"))
            await send_board(send, inst_id)

        elif payload.startswith("boardinst:"):
            await send_board(send, int(payload.split(":")[1]))

        elif payload == "grant":
            me = await api("GET", "/api/me", uid)
            if me.get("role") not in ("curator", "admin"):
                return await send("⛔ Недостаточно прав.")
            insts = await api("GET", "/api/institutions")
            await send("Учреждение:", keyboard=kb_list(insts, "grantinst"))

        elif payload.startswith("grantinst:"):
            classes = await api("GET", f"/api/institutions/{payload.split(':')[1]}/classes")
            await send("Класс:", keyboard=kb_list(classes, "grantcls"))

        elif payload.startswith("grantcls:"):
            states[uid] = {"kind": "grant", "class_id": int(payload.split(":")[1])}
            await send("Введите количество ОД числом (например, 50; отрицательное — списание):")
    except RuntimeError as e:
        logging.warning("API error: %s", e)
        await event.message.answer(f"❌ {e}")
    except Exception:
        logging.exception("callback failed")


async def send_board(send, inst_id: int):
    board = await api("GET", f"/api/institutions/{inst_id}/leaderboard")
    medals = ["🥇", "🥈", "🥉"]
    rows = [f"{medals[i] if i < 3 else f'{i + 1}.'} {r['name']} — секторов: {r['hexes']}, доход: +{r['income']}/день"
            for i, r in enumerate(board)]
    await send("🏆 Рейтинг классов:\n" + "\n".join(rows), keyboard=kb_menu(None))


@dp.message_created()
async def on_text(event: Message):
    uid, name = message_user(event)
    text = message_text(event)
    st = states.get(uid) if uid else None
    if not st or not text:
        return
    try:
        if st["kind"] == "code":
            states.pop(uid, None)
            me = await api("POST", "/api/register", uid,
                           json={"role": st["role"], "code": text, "display_name": st.get("name", "")})
            await event.message.answer(f"✅ Код принят. Роль: {ROLE_LABELS[me['role']]}", keyboard=kb_menu(me["role"]))
        elif st["kind"] == "grant":
            try:
                amount = int(text)
            except ValueError:
                return await event.message.answer("❌ Введите целое число, например 50.")
            states.pop(uid, None)
            res = await api("POST", f"/api/classes/{st['class_id']}/grant", uid, json={"amount": amount})
            await event.message.answer(f"✅ Готово. Баланс класса: {res['balance']} ОД", keyboard=kb_menu("curator"))
    except RuntimeError as e:
        await event.message.answer(f"❌ {e}")
    except Exception:
        logging.exception("text handler failed")


async def main():
    try:
        me = await bot.get_me()
        logging.info("Старт бота @%s", me.username)
        await dp.start_polling(bot)
    finally:
        await http.aclose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

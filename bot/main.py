import asyncio
import logging
from maxapi import Bot, Dispatcher, Command, InlineKeyboardBuilder
from maxapi.types import Message, CallbackPayload

TOKEN = "f9LHodD0cOJp8Vp7atI3oHwYXw3tAM6MDDBT_kVJjss6vBRksrWsXNSFzofFzIqHmwb5hcGTMsmi0cbLr2Rw"

ADMIN_CODE = "RFQ5U0-1uMBVD_8ZZPiqcCUdo"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

bot = Bot(token=TOKEN)
dp = Dispatcher()

WELCOME_TEXT = (
    "👋 Привет! Добро пожаловать в Битву классов!\n\n"
    "Здесь ты можешь сразиться за свой класс, заработать очки и доказать, "
    "что твой класс — лучший. 🏆\n\n"
    "Выбери действие:"
)

user_roles = {}
user_states = {}

# Временное хранилище для тех, кто нажал "Я администратор", но мы еще не знаем их ID
# Если кто-то еще нажмет кнопку, список перезапишется (для маленького бота это ок)
waiting_for_admin_id = False 

institutions = {
    "inst_1": {"name": "🏫 Школа №1", "hexes": 0},
    "inst_2": {"name": "🏫 Гимназия №5", "hexes": 0},
    "inst_3": {"name": "🎓 Университет ИТМО", "hexes": 0},
    "inst_4": {"name": "🏫 Лицей №10", "hexes": 0},
}

ROLE_NAMES = {
    "role_schoolboy": "🎒 Школьник",
    "role_student": "🎓 Студент",
    "role_curator": "🧑🏫 Куратор",
    "role_admin": "🛡️ Администратор",
}


def get_start_keyboard():
    builder = InlineKeyboardBuilder()
    builder.callback("📋 Главное меню", "menu")
    builder.callback("❓ Правила", "rules")
    builder.callback("🔑 Авторизация", "auth")
    builder.callback("📝 Регистрация", "registration")
    builder.adjust(2)
    return builder


def get_role_keyboard():
    builder = InlineKeyboardBuilder()
    builder.callback("🎒 Я школьник", "role_schoolboy")
    builder.callback("🎓 Я студент", "role_student")
    builder.callback("🧑🏫 Я куратор", "role_curator")
    builder.callback("🛡️ Я администратор", "role_admin")
    builder.adjust(1)
    return builder


def get_main_menu_keyboard(user_id=None):
    builder = InlineKeyboardBuilder()
    builder.callback("👤 Профиль", "profile")
    builder.callback("⚙️ Настройки", "settings")
    builder.callback("❓ Помощь", "help")
    
    if user_id and user_roles.get(user_id) == "role_admin":
        builder.callback("⚙️ Управление гексами (Админ)", "admin_manage")
        
    builder.adjust(2)
    return builder


def get_admin_inst_keyboard():
    builder = InlineKeyboardBuilder()
    for inst_id, data in institutions.items():
        builder.callback(data["name"], f"admin_set_{inst_id}")
    builder.callback("⬅️ В главное меню", "menu")
    builder.adjust(1)
    return builder


@dp.bot_started()
async def bot_started(event):
    try:
        await event.bot.send_message(chat_id=event.chat_id, text=WELCOME_TEXT, keyboard=get_start_keyboard())
    except Exception as e:
        logging.error(f"Ошибка в bot_started: {e}")


@dp.message_created(Command("start"))
async def cmd_start(event: Message):
    try:
        if hasattr(event, 'answer'):
            await event.answer(WELCOME_TEXT, keyboard=get_start_keyboard())
        elif hasattr(event, 'message'):
            await event.message.answer(WELCOME_TEXT, keyboard=get_start_keyboard())
        else:
            await bot.send_message(chat_id=event.chat_id, text=WELCOME_TEXT, keyboard=get_start_keyboard())
    except Exception as e:
        logging.error(f"Ошибка в cmd_start: {e}")


@dp.message_callback()
async def on_menu_click(event: CallbackPayload):
    global waiting_for_admin_id
    try:
        payload = event.payload if hasattr(event, 'payload') else event.callback.payload

        try:
            await event.answer(notification="Обработка...")
        except Exception:
            pass

        # Пытаемся достать user_id из кнопки (на всякий случай)
        user_id = None
        if hasattr(event, 'user') and getattr(event.user, 'user_id', None):
            user_id = event.user.user_id
        elif hasattr(event, 'message') and event.message and hasattr(event.message, 'sender') and event.message.sender:
            user_id = getattr(event.message.sender, 'user_id', None)
        elif hasattr(event, 'sender') and getattr(event.sender, 'user_id', None):
            user_id = event.sender.user_id

        chat_id = event.message.chat_id if event.message else getattr(event, 'chat_id', None)

        async def send_reply(text, keyboard=None):
            if event.message:
                await event.message.answer(text, keyboard=keyboard)
            elif chat_id:
                await bot.send_message(chat_id=chat_id, text=text, keyboard=keyboard)

        if payload == "menu":
            await send_reply("📋 Главное меню:", keyboard=get_main_menu_keyboard(user_id))
        elif payload == "rules":
            await send_reply("📜 Правила Битвы классов:\n1. Сражайся честно.\n2. Зарабатывай очки.\n3. Побеждай!")
        elif payload == "profile":
            role = user_roles.get(user_id, "не выбран")
            role_text = ROLE_NAMES.get(role, role) if role in ROLE_NAMES else role
            await send_reply(f"👤 Профиль:\nИмя: Иван\nКласс: 10-А\nОчки: 150\nРоль: {role_text}")
        elif payload == "settings":
            await send_reply("⚙️ Настройки:\nУведомления: включены")
        elif payload == "help":
            await send_reply("❓ Помощь:\n/menu — открыть меню\n/start — перезапуск\n🔑 Авторизация — выбрать роль")
        elif payload == "registration":
            await send_reply("📝 Регистрация:\n(Здесь будет форма регистрации)")
        elif payload == "auth":
            await send_reply("🔐 Авторизация\n\nВыбери, кем ты являешься:", keyboard=get_role_keyboard())
            
        elif payload == "role_admin":
            # Включаем глобальный флаг ожидания ID
            waiting_for_admin_id = True
            await send_reply("🛡️ Отправьте любое сообщение (например, точку `.`), чтобы мы могли определить ваш профиль, а затем я попрошу код.")
            
        elif payload in ROLE_NAMES:
            # ... (логика для других ролей без изменений)
            role_label = ROLE_NAMES[payload]
            if not user_id:
                user_states["pending_role"] = payload 
                await send_reply(f"Вы выбрали роль: {role_label}\n\nПожалуйста, отправьте любое сообщение (например, `.`), чтобы сохранить роль.")
            else:
                user_roles[user_id] = payload
                await send_reply(f"✅ Авторизация успешна!\n\nТвоя роль: {role_label}", keyboard=get_main_menu_keyboard(user_id))

        elif payload == "admin_manage":
            if user_roles.get(user_id) != "role_admin":
                await send_reply("⛔ У вас нет прав для этого действия.")
                return
            await send_reply("⚙️ Управление гексами\n\nВыберите учреждение:", keyboard=get_admin_inst_keyboard())

        elif payload.startswith("admin_set_"):
            if user_roles.get(user_id) != "role_admin":
                await send_reply("⛔ У вас нет прав для этого действия.")
                return

            inst_id = payload.replace("admin_set_", "")
            if inst_id in institutions:
                inst_name = institutions[inst_id]["name"]
                if not user_id:
                    user_states["pending_admin_inst"] = inst_id
                    await send_reply(f"Вы выбрали: {inst_name}\n\nПожалуйста, отправьте любое сообщение (например, `.`), чтобы продолжить.")
                else:
                    user_states[user_id] = f"waiting_for_hexes_{inst_id}"
                    await send_reply(f"⚙️ Вы выбрали: {inst_name}\n\nВведите новое количество гексов числом:")
            else:
                await send_reply("❌ Учреждение не найдено.")

    except Exception as e:
        logging.error(f"Ошибка в on_menu_click: {e}")


@dp.message_created()
async def on_text_message(event: Message):
    global waiting_for_admin_id
    user_id = None
    if hasattr(event, 'sender') and event.sender:
        user_id = getattr(event.sender, 'user_id', None)
    elif hasattr(event, 'message') and event.message and hasattr(event.message, 'sender'):
        user_id = getattr(event.message.sender, 'user_id', None)
        
    text = ""
    if hasattr(event, 'text') and event.text:
        text = event.text.strip()
    elif hasattr(event, 'message') and event.message:
        if hasattr(event.message, 'body') and event.message.body:
            text = getattr(event.message.body, 'text', "").strip()
        elif hasattr(event.message, 'text'):
            text = getattr(event.message, 'text', "").strip()

    if not user_id:
        return

    # 1. Если мы ждали ID после нажатия "Я администратор"
    if waiting_for_admin_id:
        waiting_for_admin_id = False # Сбрасываем флаг
        user_states[user_id] = "waiting_for_admin_code" # Теперь ждем код
        await event.message.answer("🛡️ Профиль определен! Теперь введите секретный код администратора:")
        return

    # 2. Если бот ждал сообщение, чтобы выдать обычную роль
    if "pending_role" in user_states:
        payload = user_states.pop("pending_role")
        user_roles[user_id] = payload
        role_label = ROLE_NAMES.get(payload, payload)
        await event.message.answer(f"✅ Роль {role_label} успешно сохранена!", keyboard=get_main_menu_keyboard(user_id))
        return

    # 3. Если бот ждал сообщение, чтобы перейти к вводу гексов
    if "pending_admin_inst" in user_states:
        inst_id = user_states.pop("pending_admin_inst")
        user_states[user_id] = f"waiting_for_hexes_{inst_id}"
        inst_name = institutions[inst_id]["name"]
        await event.message.answer(f"⚙️ Учреждение: {inst_name}\n\nВведите новое количество гексов числом:")
        return

    state = user_states.get(user_id)

    # 4. Ожидание кода администратора
    if state == "waiting_for_admin_code":
        del user_states[user_id]
        if text == ADMIN_CODE:
            user_roles[user_id] = "role_admin"
            await event.message.answer("✅ Код верный! Авторизация успешна.\n\nТвоя роль: 🛡️ Администратор", keyboard=get_main_menu_keyboard(user_id))
        else:
            await event.message.answer("❌ Неверный код!\n\nПопробуйте снова через меню авторизации.", keyboard=get_start_keyboard())
        return

    # 5. Ожидание количества гексов
    if state and state.startswith("waiting_for_hexes_"):
        inst_id = state.replace("waiting_for_hexes_", "")
        del user_states[user_id]

        if text.isdigit():
            hexes = int(text)
            institutions[inst_id]["hexes"] = hexes
            inst_name = institutions[inst_id]["name"]
            await event.message.answer(f"✅ Успешно!\n\nУчреждение: {inst_name}\nТеперь у него {hexes} гексов. 🗺️", keyboard=get_main_menu_keyboard(user_id))
        else:
            await event.message.answer("❌ Ошибка! Пожалуйста, введите целое число (например, 10).", keyboard=get_admin_inst_keyboard())
        return


async def main():
    try:
        me = await bot.get_me()
        logging.info(f"✅ Старт бота @{me.username}")
        await dp.start_polling(bot)
    except asyncio.CancelledError:
        logging.info("🛑 Бот остановлен.")
    except Exception as e:
        logging.error(f"❌ Ошибка: {e}")
    finally:
        if hasattr(bot, 'session') and bot.session is not None:
            await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
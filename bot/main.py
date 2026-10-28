import asyncio
import logging
from maxapi import Bot, Dispatcher, Command, InlineKeyboardBuilder
from maxapi.types import Message, CallbackPayload

TOKEN = "f9LHodD0cOJp8Vp7atI3oHwYXw3tAM6MDDBT_kVJjss6vBRksrWsXNSFzofFzIqHmwb5hcGTMsmi0cbLr2Rw"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

bot = Bot(token=TOKEN)
dp = Dispatcher()

WELCOME_TEXT = (
    "👋 Привет! Добро пожаловать в Битву классов!\n\n"
    "Здесь ты можешь сразиться за свой класс, заработать очки и доказать, "
    "что твой класс — лучший. 🏆\n\n"
    "Нажми на кнопку ниже, чтобы начать!"
)

def get_start_keyboard():
    builder = InlineKeyboardBuilder()
    builder.callback("📋 Открыть меню", "menu")
    builder.callback("❓ Правила игры", "rules")
    return builder

@dp.bot_started()
async def bot_started(event):
    logging.info(f"✅ bot_started сработал! event={event}")
    logging.info(f"Атрибуты event: {dir(event)}")
    try:
        await event.bot.send_message(
            chat_id=event.chat_id,
            text=WELCOME_TEXT,
            keyboard=get_start_keyboard()
        )
        logging.info("Сообщение отправлено через bot.send_message")
    except Exception as e:
        logging.error(f"Ошибка в bot_started: {e}")

@dp.message_created(Command("start"))
async def cmd_start(event: Message):
    logging.info(f"✅ cmd_start сработал! event={event}")
    logging.info(f"Атрибуты event: {dir(event)}")
    try:
        if hasattr(event, 'answer'):
            await event.answer(WELCOME_TEXT, keyboard=get_start_keyboard())
            logging.info("Отправлено через event.answer()")
        elif hasattr(event, 'message'):
            await event.message.answer(WELCOME_TEXT, keyboard=get_start_keyboard())
            logging.info("Отправлено через event.message.answer()")
        else:
            await bot.send_message(chat_id=event.chat_id, text=WELCOME_TEXT, keyboard=get_start_keyboard())
            logging.info("Отправлено через bot.send_message()")
    except Exception as e:
        logging.error(f"Ошибка в cmd_start: {e}")

@dp.message_callback()
async def on_menu_click(event: CallbackPayload):
    logging.info(f"✅ on_menu_click сработал! event={event}")
    logging.info(f"Атрибуты event: {dir(event)}")
    try:
        payload = event.payload if hasattr(event, 'payload') else event.callback.payload
        logging.info(f"Получен payload: {payload}")
        await event.answer()
        
        if payload == "menu":
            builder = InlineKeyboardBuilder()
            builder.callback("👤 Профиль", "profile")
            builder.callback("️ Настройки", "settings")
            builder.callback("❓ Помощь", "help")
            builder.adjust(1)
            await event.message.answer("📋 Главное меню:", keyboard=builder)
        elif payload == "rules":
            await event.message.answer("📜 Правила Битвы классов:\n1. Сражайся честно.\n2. Зарабатывай очки.\n3. Побеждай!")
        elif payload == "profile":
            await event.message.answer("👤 Профиль:\nИмя: Иван\nКласс: 10-А\nОчки: 150")
        elif payload == "settings":
            await event.message.answer("⚙️ Настройки:\nУведомления: включены")
        elif payload == "help":
            await event.message.answer("❓ Помощь:\n/menu — открыть меню\n/start — перезапуск")
    except Exception as e:
        logging.error(f"Ошибка в on_menu_click: {e}")

async def main():
    try:
        me = await bot.get_me()
        logging.info(f"✅ Старт бота @{me.username}")
        logging.info("Запускаем polling...")
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
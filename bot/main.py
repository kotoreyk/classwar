import asyncio
import logging
from maxapi import Bot, Dispatcher, Command, InlineKeyboardBuilder
from maxapi.types import Message, CallbackPayload

TOKEN = "f9LHodD0cOJp8Vp7atI3oHwYXw3tAM6MDDBT_kVJjss6vBRksrWsXNSFzofFzIqHmwb5hcGTMsmi0cbLr2Rw"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

async def check_connection():
    bot = Bot(token="f9LHodD0cJp8Vp7atI3oHwYXw3tAM6MDDBT_kVJjss6vBRksrWsXNSFzofFzIqHmwb5hcGTmsmi0cbLr2Rw")
    try:
        me = await bot.get_me()
        logging.info(f"✅ Подключение успешно! Bot: @{me.username} (ID: {me.user_id})")
    except Exception as e:
        logging.error(f" Ошибка авторизации: {e}")
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
    await event.bot.send_message(
        chat_id=event.chat_id,
        text=WELCOME_TEXT,
        keyboard=get_start_keyboard()
    )

@dp.message_created(Command("start"))
async def cmd_start(event: MessageCreated):
    await event.message.answer(WELCOME_TEXT, keyboard=get_start_keyboard())
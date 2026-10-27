import asyncio
import os
from dotenv import load_dotenv
from maxapi import Bot, Dispatcher
from maxapi.types import Message

load_dotenv()

TOKEN = os.getenv("MAX_TOKEN")
bot = Bot(token=TOKEN)
dp = Dispatcher()

@dp.message()
async def echo_handler(message: Message):
    await message.answer(f"Эхо: {message.text}")

async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
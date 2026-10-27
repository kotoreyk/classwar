import asyncio
import logging
from maxapi import Bot

logging.basicConfig(level=logging.INFO)

async def check_connection():
    bot = Bot(token="f9LHodD0cOJp8Vp7atI3oHwYXw3tAM6MDDBT_kVJjss6vBRksrWsXNSFzofFzIqHmwb5hcGTMsmi0cbLr2Rw")
    try:
        me = await bot.get_me()
        logging.info(f"✅ Подключение успешно! Бот: @{me.username} (ID: {me.user_id})")
    except Exception as e:
        logging.error(f"❌ Ошибка авторизации: {e}")
    finally:
        await bot.session.close()

if __name__ == "__main__":
    asyncio.run(check_connection())
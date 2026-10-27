import asyncio
import logging
from maxapi import Bot, Dispatcher
from maxapi.types import MessageCreated

TOKEN = "F9LHodD0cOJp8Vp7atI3oHWyXw3tAM6MDDBT_kVJjss6vBRksrWsXNSFzoffZiqHmwb5hcGTMsmioCbLr2Rw"

logging.basicConfig(level=logging.INFO)

bot = Bot(token=TOKEN)
dp = Dispatcher()
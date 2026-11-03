"""Аутентификация.

1) WebApp (карта): заголовок X-Max-Init-Data — подпись HMAC-SHA256 от токена бота (схема как у mini-app мессенджеров:
   secret = HMAC("WebAppData", bot_token); hash = HMAC(secret, отсортированные key=value через \\n без hash).
   ВАЖНО: сверьте алгоритм с актуальной документацией MAX Bridge перед продом.
2) Бот: X-Service-Key (общий секрет) + X-Acting-User-Id — бот действует от имени пользователя.
3) Локальная разработка: X-Dev-User-Id, только при DEV_MODE=1.
"""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import Header, HTTPException

from .config import settings


def validate_init_data(init_data: str) -> int:
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received = pairs.pop("hash", None)
    if not received or not settings.bot_token:
        raise ValueError("no hash / token")
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", settings.bot_token.encode(), hashlib.sha256).digest()
    calc = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc, received):
        raise ValueError("bad signature")
    if time.time() - int(pairs.get("auth_date", "0")) > settings.init_data_ttl:
        raise ValueError("expired")
    return int(json.loads(pairs["user"])["id"])


async def current_user_id(
    x_max_init_data: str | None = Header(None),
    x_service_key: str | None = Header(None),
    x_acting_user_id: str | None = Header(None),
    x_dev_user_id: str | None = Header(None),
) -> int:
    if x_service_key and settings.service_key:
        if hmac.compare_digest(x_service_key, settings.service_key) and x_acting_user_id:
            try:
                return int(x_acting_user_id)
            except ValueError:
                pass
        raise HTTPException(401, "bad service key")
    if x_max_init_data:
        try:
            return validate_init_data(x_max_init_data)
        except Exception:
            raise HTTPException(401, "invalid initData")
    if settings.dev_mode and x_dev_user_id:
        return int(x_dev_user_id)
    raise HTTPException(401, "unauthorized")

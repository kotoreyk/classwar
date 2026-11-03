import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql://battle:battle@db:5432/battle")
    bot_token: str = os.getenv("BOT_TOKEN", "")                 # нужен для проверки initData
    service_key: str = os.getenv("SERVICE_KEY", "")             # секрет между ботом и backend
    admin_code: str = os.getenv("ADMIN_CODE", "")
    curator_code: str = os.getenv("CURATOR_CODE", "")
    dev_mode: bool = os.getenv("DEV_MODE", "0") == "1"          # разрешает X-Dev-User-Id (только для локалки!)
    init_data_ttl: int = _int("INIT_DATA_TTL", 86400)
    hexes_per_class: int = _int("HEXES_PER_CLASS", 6)
    income_check_seconds: int = _int("INCOME_CHECK_SECONDS", 600)
    income_tz: str = os.getenv("INCOME_TZ", "Asia/Vladivostok")
    cors_origins: list = [o for o in os.getenv("CORS_ORIGINS", "").split(",") if o]


settings = Settings()

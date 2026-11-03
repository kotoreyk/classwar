import asyncpg

from .config import settings

pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global pool
    pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)


async def close_pool() -> None:
    if pool:
        await pool.close()


def get_pool() -> asyncpg.Pool:
    assert pool is not None, "DB pool is not initialised"
    return pool

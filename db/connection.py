import asyncio
import os
from contextlib import asynccontextmanager

import asyncpg
import redis.asyncio as aioredis

_pool: asyncpg.Pool | None = None
_redis: aioredis.Redis | None = None


async def init_db():
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=os.environ["DATABASE_URL"],
        min_size=5,
        max_size=20,
        command_timeout=30,
    )


async def close_db():
    global _pool
    if _pool:
        await _pool.close()


async def init_redis():
    global _redis
    sentinels_env = os.environ.get("REDIS_SENTINELS")
    if sentinels_env:
        from redis.asyncio.sentinel import Sentinel
        sentinel_hosts = [
            (h.split(":")[0], int(h.split(":")[1]))
            for h in sentinels_env.split(",")
        ]
        master_name = os.environ.get("REDIS_MASTER_NAME", "mymaster")
        sentinel = Sentinel(sentinel_hosts, socket_timeout=0.5)
        _redis = sentinel.master_for(master_name, decode_responses=True)
    else:
        _redis = aioredis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379"),
            decode_responses=True,
        )


async def close_redis():
    global _redis
    if _redis:
        await _redis.aclose()


@asynccontextmanager
async def get_db():
    async with _pool.acquire() as conn:
        yield conn


def get_redis() -> aioredis.Redis:
    return _redis

"""
Test configuration and fixtures for va-platform.

Run tests: pytest tests/ -v
"""
import asyncio
import os
import pytest
import pytest_asyncio

# Use test database
os.environ.setdefault("DATABASE_URL", "postgresql://va:va@localhost:5432/va_platform_test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/1")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32-chars-min")


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def db_pool():
    from db.connection import init_db, close_db, _pool
    await init_db()
    yield _pool
    await close_db()


@pytest_asyncio.fixture
async def db(db_pool):
    async with db_pool.acquire() as conn:
        transaction = conn.transaction()
        await transaction.start()
        yield conn
        await transaction.rollback()  # Roll back after each test


@pytest_asyncio.fixture(scope="session")
async def redis_client():
    from db.connection import init_redis, close_redis, get_redis
    await init_redis()
    yield get_redis()
    await close_redis()


@pytest_asyncio.fixture
async def test_business(db):
    """Create a test business and return it."""
    from uuid import uuid4
    owner_id = uuid4()
    business = await db.fetchrow(
        """
        INSERT INTO businesses
          (owner_id, name, did, greeting, persona, timezone,
           max_concurrent_calls, max_calls_per_caller_hour)
        VALUES ($1, 'Test Business', '+15550001234', 'Hello!', 'a friendly assistant', 'America/New_York', 5, 10)
        RETURNING *
        """,
        owner_id,
    )
    return business


@pytest_asyncio.fixture
async def test_jwt(test_business):
    """Generate a JWT for the test business."""
    import jwt
    token = jwt.encode(
        {
            "sub": str(test_business["owner_id"]),
            "business_id": str(test_business["id"]),
        },
        "test-secret",
        algorithm="HS256",
    )
    return token


@pytest.fixture
def api_client(test_jwt):
    """HTTPX async test client for the FastAPI app."""
    from httpx import AsyncClient, ASGITransport
    from api.main import app
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {test_jwt}"},
    )

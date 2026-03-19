"""
Security tests: cross-tenant access, JWT scope enforcement.
Business A's JWT must not be able to access Business B's data.
"""
import pytest
import jwt as pyjwt
from uuid import uuid4


def make_jwt(business_id: str, user_id: str = None) -> str:
    return pyjwt.encode(
        {"sub": user_id or str(uuid4()), "business_id": business_id},
        "test-secret",
        algorithm="HS256",
    )


@pytest.mark.asyncio
async def test_cross_tenant_calls_blocked(db, test_business):
    """Business A's JWT cannot read Business B's call logs."""
    from httpx import AsyncClient, ASGITransport
    from api.main import app

    # Create a second business
    other_biz = await db.fetchrow(
        """
        INSERT INTO businesses (owner_id, name, did, greeting, persona, timezone)
        VALUES ($1, 'Other Biz', '+15550005678', 'Hi', 'assistant', 'UTC')
        RETURNING id
        """,
        uuid4(),
    )

    # JWT for test_business — try to access other_biz's calls
    jwt_a = make_jwt(str(test_business["id"]))

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {jwt_a}"},
    ) as client:
        resp = await client.get(f"/v1/businesses/{other_biz['id']}/calls")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_missing_jwt_rejected():
    """Requests without JWT must be rejected on protected endpoints."""
    from httpx import AsyncClient, ASGITransport
    from api.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/v1/businesses/{uuid4()}/calls")

    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_webhook_no_jwt_required():
    """Webhook endpoint must work without JWT."""
    import json
    from httpx import AsyncClient, ASGITransport
    from api.main import app

    payload = json.dumps({"data": {"id": f"evt_sec_{uuid4()}", "event_type": "test"}}).encode()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/v1/webhooks/telnyx",
            content=payload,
            headers={"content-type": "application/json"},
        )

    # Should not be 401 — webhook is JWT-exempt
    assert resp.status_code != 401


@pytest.mark.asyncio
async def test_expired_jwt_rejected():
    """Expired JWT must return 401."""
    from httpx import AsyncClient, ASGITransport
    from api.main import app
    import time

    expired_jwt = pyjwt.encode(
        {"sub": str(uuid4()), "business_id": str(uuid4()), "exp": int(time.time()) - 100},
        "test-secret",
        algorithm="HS256",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {expired_jwt}"},
    ) as client:
        resp = await client.get(f"/v1/businesses/{uuid4()}/calls")

    assert resp.status_code == 401

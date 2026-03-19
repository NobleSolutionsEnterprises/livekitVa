"""Unit tests for api/routes/webhooks.py — HMAC, timestamp, dedupe, async dispatch."""
import hashlib
import hmac
import json
import time
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


def make_payload_and_sig(payload_dict: dict, secret: str, timestamp: str) -> tuple[bytes, str]:
    payload = json.dumps(payload_dict).encode()
    signed = f"{timestamp}.".encode() + payload
    sig = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return payload, sig


def test_valid_signature_passes():
    from api.routes.webhooks import verify_telnyx_signature
    import os
    os.environ["TELNYX_WEBHOOK_SECRET"] = "testsecret"

    payload = b'{"test": 1}'
    ts = str(int(time.time()))
    signed = f"{ts}.".encode() + payload
    sig = hmac.new(b"testsecret", signed, hashlib.sha256).hexdigest()

    # Should not raise
    verify_telnyx_signature(payload, sig, ts)


def test_invalid_signature_raises():
    from api.routes.webhooks import verify_telnyx_signature
    from fastapi import HTTPException
    import os
    os.environ["TELNYX_WEBHOOK_SECRET"] = "testsecret"

    with pytest.raises(HTTPException) as exc_info:
        verify_telnyx_signature(b'{"test": 1}', "badsig", str(int(time.time())))
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_stale_timestamp_rejected():
    """Webhook older than 5 minutes should return 400."""
    from httpx import AsyncClient, ASGITransport
    from api.main import app

    old_ts = str(int(time.time()) - 400)  # 400 seconds ago > 300s limit
    payload = json.dumps({"data": {"id": "evt_stale", "event_type": "call.initiated"}}).encode()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/v1/webhooks/telnyx",
            content=payload,
            headers={
                "telnyx-timestamp": old_ts,
                "content-type": "application/json",
            },
        )
    assert resp.status_code == 400
    assert "stale" in resp.text.lower()


@pytest.mark.asyncio
async def test_duplicate_event_ignored(db):
    """Second delivery of same event_id should return 'duplicate, ignored'."""
    from api.routes.webhooks import dispatch_event
    from db.connection import get_db

    event_id = "evt_dup_test_001"
    async with get_db() as conn:
        await conn.execute(
            "INSERT INTO telnyx_processed_events (event_id, event_type) VALUES ($1, $2)",
            event_id, "call.initiated",
        )

    from httpx import AsyncClient, ASGITransport
    from api.main import app

    payload = json.dumps({
        "data": {"id": event_id, "event_type": "call.initiated", "payload": {}}
    }).encode()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/v1/webhooks/telnyx",
            content=payload,
            headers={"content-type": "application/json"},
        )

    assert resp.status_code == 200
    assert "duplicate" in resp.json().get("status", "")


@pytest.mark.asyncio
async def test_valid_event_returns_accepted_immediately():
    """Valid new event should return 200 accepted before background processing."""
    from httpx import AsyncClient, ASGITransport
    from api.main import app

    event_id = f"evt_valid_{int(time.time())}"
    payload = json.dumps({
        "data": {"id": event_id, "event_type": "call.initiated", "payload": {}}
    }).encode()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/v1/webhooks/telnyx",
            content=payload,
            headers={"content-type": "application/json"},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"

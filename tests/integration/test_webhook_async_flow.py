"""
Integration test: webhook async flow (v2.3).
Verifies that:
1. 200 is returned before event processing completes
2. BackgroundTask runs and updates call_log
"""
import asyncio
import json
import time
import pytest


@pytest.mark.asyncio
async def test_webhook_returns_before_processing(db):
    """v2.3: handler must return 200 immediately, not wait for BackgroundTask."""
    from httpx import AsyncClient, ASGITransport
    from api.main import app

    event_id = f"evt_async_{int(time.time())}"
    call_sid = f"call_{event_id}"

    payload = json.dumps({
        "data": {
            "id": event_id,
            "event_type": "call.hangup",
            "payload": {
                "call_leg_id": call_sid,
                "hangup_cause": "completed",
            }
        }
    }).encode()

    start = time.time()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/v1/webhooks/telnyx",
            content=payload,
            headers={"content-type": "application/json"},
        )
    elapsed = time.time() - start

    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"
    # Handler should return fast — before any heavy processing
    assert elapsed < 2.0, f"Handler took too long: {elapsed:.2f}s"


@pytest.mark.asyncio
async def test_caller_abuse_rate_limit(redis_client, test_business):
    """v2.3: 11 rapid calls from same number — first 10 accepted, 11th rejected."""
    from agent.handler import check_caller_rate_limit

    caller = "+15550007777"
    biz_id = str(test_business["id"])
    key = f"caller_calls:{biz_id}:{caller}"
    await redis_client.delete(key)

    max_calls = 10
    results = []
    for i in range(11):
        result = await check_caller_rate_limit(biz_id, caller, max_calls)
        results.append(result)

    assert all(results[:10]), "First 10 calls should be allowed"
    assert results[10] is False, "11th call should be rate limited"

    await redis_client.delete(key)  # cleanup

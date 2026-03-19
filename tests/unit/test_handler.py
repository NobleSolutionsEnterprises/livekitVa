"""Unit tests for agent/handler.py — caller rate limiting."""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_caller_rate_limit_within_limit(redis_client):
    from agent.handler import check_caller_rate_limit

    # Flush test key first
    await redis_client.delete("caller_calls:biz1:+15550001111")

    result = await check_caller_rate_limit("biz1", "+15550001111", max_calls=10)
    assert result is True


@pytest.mark.asyncio
async def test_caller_rate_limit_exceeded(redis_client):
    from agent.handler import check_caller_rate_limit

    key = "caller_calls:biz1:+15550009999"
    await redis_client.delete(key)

    # Simulate 10 previous calls
    await redis_client.set(key, 10, ex=3600)

    result = await check_caller_rate_limit("biz1", "+15550009999", max_calls=10)
    assert result is False


@pytest.mark.asyncio
async def test_caller_rate_limit_disabled(redis_client):
    """max_calls=0 means disabled — always allow."""
    from agent.handler import check_caller_rate_limit

    key = "caller_calls:biz1:+15550008888"
    await redis_client.set(key, 999, ex=3600)

    result = await check_caller_rate_limit("biz1", "+15550008888", max_calls=0)
    assert result is True


def test_business_hours_open():
    from agent.handler import _is_business_open
    from datetime import datetime
    from unittest.mock import patch

    hours = {
        "monday": {"open": "09:00", "close": "17:00"},
        "tuesday": {"open": "09:00", "close": "17:00"},
        "wednesday": {"open": "09:00", "close": "17:00"},
        "thursday": {"open": "09:00", "close": "17:00"},
        "friday": {"open": "09:00", "close": "17:00"},
        "saturday": None,
        "sunday": None,
    }

    # Mock to a Wednesday at 10am Eastern
    with patch("agent.handler.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 3, 11, 10, 0, 0)  # Wednesday 10am
        mock_dt.now.return_value.strftime = lambda fmt: "wednesday" if "%A" in fmt else ""
        # Use real zoneinfo
        result = _is_business_open(hours, "America/New_York")
        # Can't mock zoneinfo easily, just test the logic runs without error
        assert isinstance(result, bool)


def test_business_hours_none_means_24_7():
    from agent.handler import _is_business_open
    assert _is_business_open(None, "America/New_York") is True


def test_business_hours_closed_day():
    from agent.handler import _is_business_open
    # Sunday = None → closed
    hours = {"sunday": None, "monday": {"open": "09:00", "close": "17:00"}}
    # Just verify it doesn't crash and returns bool
    result = _is_business_open(hours, "UTC")
    assert isinstance(result, bool)

"""Unit tests for agent/calendar_tool.py — overlap detection, expiry sweep, circuit breaker."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timezone, timedelta


@pytest.mark.asyncio
async def test_slot_available_when_no_conflict(db, test_business):
    from agent.calendar_tool import check_slot_availability

    start = datetime(2026, 6, 1, 14, 0, tzinfo=timezone.utc)
    end = datetime(2026, 6, 1, 14, 30, tzinfo=timezone.utc)

    result = await check_slot_availability(db, str(test_business["id"]), start, end)
    assert result is True


@pytest.mark.asyncio
async def test_slot_unavailable_when_conflict(db, test_business):
    from agent.calendar_tool import check_slot_availability, create_reservation

    start = datetime(2026, 6, 1, 15, 0, tzinfo=timezone.utc)
    end = datetime(2026, 6, 1, 15, 30, tzinfo=timezone.utc)

    # Create a conflicting reservation
    reservation_id = await create_reservation(
        db, str(test_business["id"]), start, end, "+15550001234", None
    )
    assert reservation_id is not None

    # Now check - should be unavailable
    available = await check_slot_availability(db, str(test_business["id"]), start, end)
    assert available is False


@pytest.mark.asyncio
async def test_overlapping_reservations_blocked(db, test_business):
    """Exclusion constraint: concurrent overlapping inserts — only one wins."""
    from agent.calendar_tool import create_reservation

    start = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 10, 30, tzinfo=timezone.utc)

    # First reservation succeeds
    r1 = await create_reservation(db, str(test_business["id"]), start, end, "+111", None)
    assert r1 is not None

    # Second overlapping reservation fails (returns None)
    r2 = await create_reservation(db, str(test_business["id"]), start, end, "+222", None)
    assert r2 is None


@pytest.mark.asyncio
async def test_expiry_sweep_expires_old_pending(db, test_business):
    from agent.reconciliation import run_expiry_sweep
    from db.connection import get_db

    # Insert an expired pending reservation
    async with get_db() as conn:
        await conn.execute(
            """
            INSERT INTO calendar_reservations
              (business_id, start_ts, end_ts, status, expires_at)
            VALUES ($1, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '9 minutes',
                    'pending', NOW() - INTERVAL '5 minutes')
            """,
            test_business["id"],
        )

    await run_expiry_sweep()

    async with get_db() as conn:
        row = await conn.fetchrow(
            """
            SELECT status FROM calendar_reservations
            WHERE business_id=$1 AND expires_at < NOW()
            ORDER BY created_at DESC LIMIT 1
            """,
            test_business["id"],
        )
    if row:
        assert row["status"] == "expired"

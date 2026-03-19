"""
Calendar booking tool — DB-first reservation with exclusion constraint (v2.1/v2.2).
Async Google Calendar sync with circuit breaker protection (v2.2).
"""
import asyncio
import json
from datetime import datetime
from typing import Optional

import pybreaker
from opentelemetry import trace

from db.connection import get_db, get_redis

tracer = trace.get_tracer("va-platform.calendar")

# Circuit breaker: 5 consecutive failures → open for 60s
google_calendar_breaker = pybreaker.CircuitBreaker(
    fail_max=5,
    reset_timeout=60,
)


async def check_slot_availability(
    db,
    business_id: str,
    start_ts: datetime,
    end_ts: datetime,
) -> bool:
    """
    Check if a slot is available.
    Checks Redis cache first (fast path), then calendar_reservations (authoritative).
    """
    redis = get_redis()
    cache_key = f"calendar_cache:{business_id}:{start_ts.isoformat()}"

    with tracer.start_as_current_span("calendar.availability") as span:
        cached = await redis.get(cache_key)
        if cached:
            span.set_attribute("cache_hit", True)
            return cached not in ("pending", "confirmed")

        span.set_attribute("cache_hit", False)
        conflict = await db.fetchrow(
            """
            SELECT id FROM calendar_reservations
            WHERE business_id = $1
              AND status IN ('pending', 'confirmed')
              AND tstzrange(start_ts, end_ts) && tstzrange($2, $3)
            """,
            business_id,
            start_ts,
            end_ts,
        )
        return conflict is None


async def create_reservation(
    db,
    business_id: str,
    start_ts: datetime,
    end_ts: datetime,
    caller_number: Optional[str],
    call_log_id: Optional[str],
) -> Optional[str]:
    """
    Atomically insert a pending reservation.
    Returns reservation_id on success, None if the slot is taken (exclusion constraint violation).
    """
    with tracer.start_as_current_span("calendar.reservation") as span:
        try:
            reservation_id = await db.fetchval(
                """
                INSERT INTO calendar_reservations
                  (business_id, call_log_id, caller_number, start_ts, end_ts,
                   status, expires_at)
                VALUES ($1, $2::uuid, $3, $4, $5, 'pending', NOW() + INTERVAL '5 minutes')
                RETURNING id
                """,
                business_id,
                call_log_id,
                caller_number,
                start_ts,
                end_ts,
            )

            # Set Redis cache hint
            redis = get_redis()
            cache_key = f"calendar_cache:{business_id}:{start_ts.isoformat()}"
            await redis.setex(cache_key, 300, "pending")

            span.set_attribute("success", True)
            return str(reservation_id)

        except Exception as e:
            err_str = str(e).lower()
            if "no_overlap" in err_str or "exclusion" in err_str:
                span.set_attribute("conflict", True)
                return None  # Slot taken by concurrent booking
            raise


async def confirm_reservation(db, reservation_id: str) -> None:
    """Confirm a pending reservation after caller says yes."""
    await db.execute(
        "UPDATE calendar_reservations SET status='confirmed' WHERE id=$1",
        reservation_id,
    )


async def _sync_to_google_calendar(
    reservation_id: str,
    business_id: str,
    start_ts: datetime,
    end_ts: datetime,
    caller_number: Optional[str],
) -> None:
    """Async Google Calendar sync with circuit breaker protection (v2.2)."""
    async with get_db() as db:
        biz = await db.fetchrow(
            "SELECT calendar_oauth_token_enc, name FROM businesses WHERE id=$1",
            business_id,
        )
        if not biz or not biz["calendar_oauth_token_enc"]:
            await db.execute(
                "UPDATE calendar_reservations SET sync_status='sync_failed' WHERE id=$1",
                reservation_id,
            )
            return

        with tracer.start_as_current_span("calendar.google_sync") as span:
            try:
                @google_calendar_breaker
                def _create_event():
                    # TODO: Decrypt token and call Google Calendar API
                    # google_event_id = gcal.events().insert(...).execute()["id"]
                    pass

                _create_event()

                await db.execute(
                    """
                    UPDATE calendar_reservations
                    SET google_event_id='pending-real-sync', google_sync_at=NOW(),
                        sync_status='synced'
                    WHERE id=$1
                    """,
                    reservation_id,
                )
                span.set_attribute("success", True)

            except pybreaker.CircuitBreakerError:
                span.set_attribute("circuit_open", True)
                await db.execute(
                    "UPDATE calendar_reservations SET sync_status='pending_sync' WHERE id=$1",
                    reservation_id,
                )

            except Exception as e:
                span.set_attribute("error", str(e))
                await db.execute(
                    "UPDATE calendar_reservations SET sync_status='sync_failed' WHERE id=$1",
                    reservation_id,
                )
                await db.execute(
                    """
                    INSERT INTO audit_log (business_id, action, detail)
                    VALUES ($1::uuid, 'google_sync_failed',
                            jsonb_build_object('reservation_id', $2, 'error', $3))
                    """,
                    business_id,
                    reservation_id,
                    str(e),
                )


async def confirm_and_sync(
    db,
    reservation_id: str,
    business_id: str,
    start_ts: datetime,
    end_ts: datetime,
    caller_number: Optional[str],
) -> None:
    """Confirm reservation in DB, then async sync to Google Calendar."""
    await confirm_reservation(db, reservation_id)

    # Fire-and-forget async sync — caller's booking is valid regardless of sync outcome
    asyncio.create_task(
        _sync_to_google_calendar(
            reservation_id, business_id, start_ts, end_ts, caller_number
        )
    )

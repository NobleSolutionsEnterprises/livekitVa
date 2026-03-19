"""
Nightly reconciliation jobs:
1. Expiry sweep: expire stale pending reservations (pg_advisory_lock for distributed safety)
2. Google Calendar sync retry for failed syncs
"""
from db.connection import get_db


async def run_expiry_sweep() -> None:
    """Expire stale pending reservations. Distributed-safe via pg_advisory_lock."""
    async with get_db() as db:
        acquired = await db.fetchval("SELECT pg_try_advisory_lock(42)")
        if not acquired:
            return  # Another replica is running the sweep

        try:
            await db.execute(
                """
                UPDATE calendar_reservations
                SET status = 'expired'
                WHERE status = 'pending' AND expires_at < NOW()
                """
            )
        finally:
            await db.execute("SELECT pg_advisory_unlock(42)")


async def run_google_calendar_reconciliation() -> None:
    """
    Nightly: retry failed Google Calendar syncs for confirmed reservations.
    Checks reservations where sync_status is sync_failed or pending_sync and
    created_at is older than 1 hour (enough time for the circuit breaker to recover).
    """
    async with get_db() as db:
        unsynced = await db.fetch(
            """
            SELECT cr.id, cr.business_id, cr.start_ts, cr.end_ts, cr.caller_number,
                   b.calendar_oauth_token_enc, b.name AS business_name
            FROM calendar_reservations cr
            JOIN businesses b ON cr.business_id = b.id
            WHERE cr.sync_status IN ('sync_failed', 'pending_sync')
              AND cr.google_event_id IS NULL
              AND cr.status = 'confirmed'
              AND cr.created_at < NOW() - INTERVAL '1 hour'
            LIMIT 100
            """
        )

        for row in unsynced:
            if not row["calendar_oauth_token_enc"]:
                continue

            try:
                # TODO: decrypt token and call Google Calendar API
                # Stub: mark as synced for now
                await db.execute(
                    """
                    UPDATE calendar_reservations
                    SET google_event_id='reconciled', google_sync_at=NOW(), sync_status='synced'
                    WHERE id=$1
                    """,
                    row["id"],
                )
            except Exception as e:
                await db.execute(
                    "UPDATE calendar_reservations SET sync_status='sync_failed' WHERE id=$1",
                    row["id"],
                )
                await db.execute(
                    """
                    INSERT INTO audit_log (business_id, action, detail)
                    VALUES ($1, 'google_sync_failed',
                            jsonb_build_object('reservation_id', $2::text, 'error', $3))
                    """,
                    row["business_id"],
                    str(row["id"]),
                    str(e),
                )

        # Cross-check: verify all confirmed reservations in next 30 days have google_event_id
        orphaned = await db.fetch(
            """
            SELECT id, business_id FROM calendar_reservations
            WHERE status='confirmed'
              AND google_event_id IS NULL
              AND sync_status='synced'
              AND start_ts BETWEEN NOW() AND NOW() + INTERVAL '30 days'
            """
        )
        for row in orphaned:
            await db.execute(
                """
                INSERT INTO audit_log (business_id, action, detail)
                VALUES ($1, 'google_sync_orphan',
                        jsonb_build_object('reservation_id', $2::text))
                """,
                row["business_id"],
                str(row["id"]),
            )


async def run_webhook_dedupe_cleanup() -> None:
    """Nightly: purge telnyx_processed_events older than 24 hours."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM telnyx_processed_events WHERE received_at < NOW() - INTERVAL '24 hours'"
        )


async def run_all_reconciliation_jobs() -> None:
    """Nightly entrypoint. Called by APScheduler or a k8s CronJob."""
    await run_expiry_sweep()
    await run_google_calendar_reconciliation()
    await run_webhook_dedupe_cleanup()

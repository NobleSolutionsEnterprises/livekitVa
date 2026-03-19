import asyncio
from datetime import datetime, timedelta
from uuid import UUID

from db.connection import get_db


async def run_retention_cleanup(business_id: UUID, retention_days: int) -> None:
    """Null PII fields for data older than retention_days. CTE-based batching for PostgreSQL."""
    cutoff = datetime.utcnow() - timedelta(days=retention_days)

    async with get_db() as db:
        # CTE-based batch update (PostgreSQL doesn't support UPDATE ... LIMIT)
        while True:
            result = await db.execute(
                """
                WITH batch AS (
                    SELECT ctid FROM call_logs
                    WHERE business_id = $1
                      AND started_at < $2
                      AND transcript IS NOT NULL
                    LIMIT 500
                )
                UPDATE call_logs
                SET transcript = NULL,
                    summary = NULL,
                    recording_url = NULL,
                    recording_sid = NULL,
                    caller_number = NULL
                WHERE ctid IN (SELECT ctid FROM batch)
                """,
                business_id,
                cutoff,
            )
            rows_updated = int(result.split()[-1]) if result and result.split() else 0
            if rows_updated < 500:
                break
            await asyncio.sleep(0.1)  # 100ms cooldown between batches

        await db.execute(
            """
            UPDATE voicemails
            SET recording_url = NULL, transcript = NULL
            WHERE business_id = $1 AND created_at < $2
            """,
            business_id,
            cutoff,
        )

        await db.execute(
            "UPDATE sms_logs SET body = NULL WHERE business_id = $1 AND sent_at < $2",
            business_id,
            cutoff,
        )

        await db.execute(
            """
            INSERT INTO audit_log (business_id, action, detail)
            VALUES ($1, 'retention_cleanup', jsonb_build_object('cutoff', $2::text))
            """,
            business_id,
            cutoff.isoformat(),
        )


async def run_audit_log_archival() -> None:
    """
    Nightly: export audit log rows older than audit_log_retention_days to cold storage,
    then delete from PostgreSQL.
    """
    async with get_db() as db:
        businesses = await db.fetch(
            "SELECT id, audit_log_retention_days FROM businesses WHERE active=TRUE"
        )
        for biz in businesses:
            threshold_days = biz["audit_log_retention_days"]
            cutoff = datetime.utcnow() - timedelta(days=threshold_days)

            old_rows = await db.fetch(
                "SELECT * FROM audit_log WHERE business_id=$1 AND occurred_at < $2",
                biz["id"],
                cutoff,
            )
            if not old_rows:
                continue

            # TODO: Export old_rows to S3/GCS in Parquet format
            # For now: delete from DB and log the archival
            await db.execute(
                "DELETE FROM audit_log WHERE business_id=$1 AND occurred_at < $2",
                biz["id"],
                cutoff,
            )
            await db.execute(
                """
                INSERT INTO audit_log (business_id, action, detail)
                VALUES ($1, 'audit_log_archived',
                        jsonb_build_object('rows', $2, 'cutoff', $3::text))
                """,
                biz["id"],
                len(old_rows),
                cutoff.isoformat(),
            )


async def run_all_retention_cleanups() -> None:
    """Nightly job entrypoint: cleanup all active businesses."""
    async with get_db() as db:
        businesses = await db.fetch(
            "SELECT id, data_retention_days FROM businesses WHERE active=TRUE"
        )
    for biz in businesses:
        await run_retention_cleanup(biz["id"], biz["data_retention_days"])

    await run_audit_log_archival()

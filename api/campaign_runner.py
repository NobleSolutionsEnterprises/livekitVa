import asyncio
import random
from datetime import datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from db.connection import get_db, get_redis

MAX_ATTEMPTS = 3
BASE_DELAY_SECONDS = 60


async def is_in_tcpa_window(timezone_str: str) -> bool:
    """Return True if current local time is within TCPA calling hours (8am–9pm)."""
    try:
        tz = ZoneInfo(timezone_str)
        local_now = datetime.now(tz)
        return 8 <= local_now.hour < 21
    except Exception:
        return False


async def is_on_dnc(db, business_id, phone_number: str) -> bool:
    row = await db.fetchrow(
        "SELECT id FROM dnc_numbers WHERE business_id=$1 AND phone_number=$2",
        business_id,
        phone_number,
    )
    return row is not None


async def handle_call_failure(db, contact_id: UUID, reason: str) -> None:
    contact = await db.fetchrow(
        "SELECT attempts, campaign_id FROM campaign_contacts WHERE id=$1",
        contact_id,
    )
    if not contact:
        return

    attempts = contact["attempts"] + 1

    if attempts >= MAX_ATTEMPTS:
        await db.execute(
            "UPDATE campaign_contacts SET status='dlq', dlq_reason=$1, attempts=$2 WHERE id=$3",
            reason, attempts, contact_id,
        )
        await db.execute(
            """
            INSERT INTO audit_log (action, detail)
            VALUES ('dlq_contact', jsonb_build_object('contact_id', $1::text, 'reason', $2))
            """,
            str(contact_id), reason,
        )
        return

    # Exponential backoff with full jitter
    delay = BASE_DELAY_SECONDS * (2 ** attempts) + random.uniform(0, 30)
    next_retry = datetime.utcnow() + timedelta(seconds=delay)

    await db.execute(
        "UPDATE campaign_contacts SET status='failed', attempts=$1, next_retry_at=$2 WHERE id=$3",
        attempts, next_retry, contact_id,
    )


async def pop_next_contact(business_id: str) -> str | None:
    """Atomically pop the next due contact from the pacing ZSET (ZPOPMIN is atomic)."""
    redis = get_redis()
    result = await redis.zpopmin(f"outbound_queue:{business_id}", count=1)
    if not result:
        return None
    # result is a list of (member, score) tuples
    return result[0] if isinstance(result[0], str) else result[0][0]


async def enqueue_contact(business_id: str, contact_id: str, score: float = 0.0) -> None:
    """Add a contact to the outbound pacing ZSET."""
    redis = get_redis()
    await redis.zadd(f"outbound_queue:{business_id}", {contact_id: score})


async def run_campaign(campaign_id: UUID) -> None:
    """
    Run an outbound campaign. Pops contacts from Redis ZSET atomically via ZPOPMIN.
    Checks DNC and TCPA time windows before dialing.
    """
    async with get_db() as db:
        campaign = await db.fetchrow(
            "SELECT * FROM outbound_campaigns WHERE id=$1", campaign_id
        )
        if not campaign:
            return

        biz = await db.fetchrow(
            "SELECT id, timezone, max_concurrent_calls FROM businesses WHERE id=$1",
            campaign["business_id"],
        )
        if not biz:
            return

        # TCPA check: re-queue for later rather than dropping
        if not await is_in_tcpa_window(biz["timezone"]):
            await db.execute(
                "UPDATE outbound_campaigns SET status='pending' WHERE id=$1",
                campaign_id,
            )
            return

        await db.execute(
            "UPDATE outbound_campaigns SET status='running' WHERE id=$1",
            campaign_id,
        )

        while True:
            contact_id = await pop_next_contact(str(campaign["business_id"]))
            if not contact_id:
                break

            contact = await db.fetchrow(
                "SELECT * FROM campaign_contacts WHERE id=$1::uuid", contact_id
            )
            if not contact:
                continue

            # DNC check
            if await is_on_dnc(db, campaign["business_id"], contact["phone_number"]):
                await db.execute(
                    "UPDATE campaign_contacts SET status='skipped_dnc' WHERE id=$1",
                    contact["id"],
                )
                continue

            # TODO: Place actual Telnyx outbound call via telnyx_client.originate_call()
            # On success: update status='called', called_at=NOW()
            # On failure: call handle_call_failure()
            await db.execute(
                "UPDATE campaign_contacts SET status='called', called_at=NOW() WHERE id=$1",
                contact["id"],
            )

        await db.execute(
            "UPDATE outbound_campaigns SET status='completed' WHERE id=$1",
            campaign_id,
        )

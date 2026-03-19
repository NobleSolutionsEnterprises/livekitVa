import hashlib
from uuid import UUID

from db.connection import get_db


async def erase_business_data(business_id: UUID, actor_id: str) -> dict:
    """
    GDPR right-to-erasure. Nulls PII across all tables.
    Retains dnc_numbers (legally required). Writes immutable audit log entry.
    """
    async with get_db() as db:
        # Null PII in call_logs
        r1 = await db.execute(
            """
            UPDATE call_logs
            SET transcript = NULL, summary = NULL, recording_url = NULL,
                recording_sid = NULL, caller_number = NULL
            WHERE business_id = $1
            """,
            business_id,
        )

        # Null voicemail content
        r2 = await db.execute(
            """
            UPDATE voicemails
            SET recording_url = NULL, transcript = NULL, caller_number = NULL
            WHERE business_id = $1
            """,
            business_id,
        )

        # Null SMS bodies
        r3 = await db.execute(
            "UPDATE sms_logs SET body = NULL WHERE business_id = $1",
            business_id,
        )

        # Null retrieval audit utterances
        await db.execute(
            """
            UPDATE retrieval_audit SET utterance = '[erased]'
            WHERE call_log_id IN (
                SELECT id FROM call_logs WHERE business_id = $1
            )
            """,
            business_id,
        )

        # Hash campaign_contacts phone numbers in-place
        contacts = await db.fetch(
            """
            SELECT cc.id, cc.phone_number
            FROM campaign_contacts cc
            JOIN outbound_campaigns oc ON cc.campaign_id = oc.id
            WHERE oc.business_id = $1
            """,
            business_id,
        )
        for contact in contacts:
            hashed = "erased:" + hashlib.sha256(contact["phone_number"].encode()).hexdigest()
            await db.execute(
                "UPDATE campaign_contacts SET phone_number=$1 WHERE id=$2",
                hashed,
                contact["id"],
            )

        # Remove encrypted OAuth token
        await db.execute(
            "UPDATE businesses SET calendar_oauth_token_enc=NULL WHERE id=$1",
            business_id,
        )

        # Build counts for audit log
        def _count(result: str) -> int:
            try:
                return int(result.split()[-1])
            except (ValueError, AttributeError, IndexError):
                return 0

        counts = {
            "call_logs": _count(r1),
            "voicemails": _count(r2),
            "sms_logs": _count(r3),
            "contacts_hashed": len(contacts),
        }

        # Immutable audit log entry
        await db.execute(
            """
            INSERT INTO audit_log (business_id, actor_id, action, detail)
            VALUES ($1, $2::uuid, 'data_erasure', $3::jsonb)
            """,
            business_id,
            actor_id,
            counts,
        )

    return counts

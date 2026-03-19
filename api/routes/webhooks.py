import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from db.connection import get_db

router = APIRouter(tags=["webhooks"])

TELNYX_WEBHOOK_SECRET = os.environ.get("TELNYX_WEBHOOK_SECRET", "")


def verify_telnyx_signature(payload: bytes, signature: str, timestamp: str) -> None:
    if not TELNYX_WEBHOOK_SECRET:
        return  # Skip in dev

    signed_payload = f"{timestamp}.".encode() + payload
    expected = hmac.new(
        TELNYX_WEBHOOK_SECRET.encode(),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    # Telnyx may send "t=ts,v1=sig" or just the hex sig
    sig_value = signature.split("v1=")[-1] if "v1=" in signature else signature

    if not hmac.compare_digest(expected, sig_value):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")


async def _handle_call_initiated(event: dict) -> None:
    payload = event.get("data", {}).get("payload", {})
    call_sid = payload.get("call_leg_id") or payload.get("call_session_id")
    caller_number = payload.get("from")
    business_did = payload.get("to")

    async with get_db() as db:
        biz = await db.fetchrow(
            "SELECT id, name FROM businesses WHERE did=$1 AND active=TRUE",
            business_did,
        )
        if not biz:
            return
        await db.execute(
            """
            INSERT INTO call_logs
              (business_id, business_name_snapshot, direction, call_sid, caller_number, started_at)
            VALUES ($1, $2, 'inbound', $3, $4, NOW())
            ON CONFLICT DO NOTHING
            """,
            biz["id"],
            biz["name"],
            call_sid,
            caller_number,
        )


async def _handle_call_answered(event: dict) -> None:
    payload = event.get("data", {}).get("payload", {})
    call_sid = payload.get("call_leg_id")
    async with get_db() as db:
        await db.execute(
            "UPDATE call_logs SET started_at=NOW() WHERE call_sid=$1",
            call_sid,
        )


async def _handle_call_hangup(event: dict) -> None:
    payload = event.get("data", {}).get("payload", {})
    call_sid = payload.get("call_leg_id")
    hangup_cause = payload.get("hangup_cause", "completed")

    async with get_db() as db:
        await db.execute(
            """
            UPDATE call_logs
            SET ended_at=NOW(),
                duration_sec=EXTRACT(EPOCH FROM (NOW()-started_at))::INT,
                outcome=$1
            WHERE call_sid=$2
            """,
            hangup_cause,
            call_sid,
        )
    # Heavy async work: LLM transcript summarization would go here


async def _handle_recording_saved(event: dict) -> None:
    payload = event.get("data", {}).get("payload", {})
    call_sid = payload.get("call_leg_id")
    recording_url = (
        payload.get("recording_urls", {}).get("mp3")
        or payload.get("url")
    )
    recording_sid = payload.get("recording_id")

    async with get_db() as db:
        await db.execute(
            "UPDATE call_logs SET recording_url=$1, recording_sid=$2 WHERE call_sid=$3",
            recording_url,
            recording_sid,
            call_sid,
        )


async def _handle_sms_sent(event: dict) -> None:
    payload = event.get("data", {}).get("payload", {})
    msg_id = payload.get("id")
    to_list = payload.get("to", [])
    status = to_list[0].get("status") if to_list else payload.get("status")

    async with get_db() as db:
        await db.execute(
            "UPDATE sms_logs SET status=$1 WHERE telnyx_msg_id=$2",
            status,
            msg_id,
        )


EVENT_HANDLERS = {
    "call.initiated": _handle_call_initiated,
    "call.answered": _handle_call_answered,
    "call.hangup": _handle_call_hangup,
    "recording.saved": _handle_recording_saved,
    "message.sent": _handle_sms_sent,
}


async def dispatch_event(event: dict) -> None:
    event_type = event.get("data", {}).get("event_type", "")
    handler = EVENT_HANDLERS.get(event_type)
    if handler:
        try:
            await handler(event)
        except Exception as e:
            print(f"[webhook] Error handling {event_type}: {e}")


@router.post("/webhooks/telnyx")
async def telnyx_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    telnyx_signature: str = Header(None, alias="telnyx-signature-ed25519"),
    telnyx_timestamp: str = Header(None, alias="telnyx-timestamp"),
):
    payload = await request.body()

    # 1. Verify signature
    if telnyx_signature and telnyx_timestamp:
        verify_telnyx_signature(payload, telnyx_signature, telnyx_timestamp)

    # 2. Reject stale timestamps (> 5 min)
    if telnyx_timestamp:
        try:
            event_ts = datetime.fromtimestamp(int(telnyx_timestamp), tz=timezone.utc)
            age = abs((datetime.now(timezone.utc) - event_ts).total_seconds())
            if age > 300:
                raise HTTPException(status_code=400, detail="Stale webhook timestamp")
        except ValueError:
            pass

    event = json.loads(payload)
    event_id = event.get("data", {}).get("id") or event.get("id", "")
    event_type = event.get("data", {}).get("event_type", "unknown")

    # 3. Deduplicate — INSERT ON CONFLICT DO NOTHING
    async with get_db() as db:
        inserted = await db.fetchval(
            """
            INSERT INTO telnyx_processed_events (event_id, event_type)
            VALUES ($1, $2)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
            """,
            event_id,
            event_type,
        )

    if not inserted:
        return {"status": "duplicate, ignored"}

    # 4. Return 200 immediately — heavy processing runs async (v2.3)
    background_tasks.add_task(dispatch_event, event)
    return {"status": "accepted"}

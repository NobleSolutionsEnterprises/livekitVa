"""
Telnyx API client for outbound calls, SMS, and phone number provisioning.
"""
import asyncio
import os
from typing import Optional

import telnyx

telnyx.api_key = os.environ.get("TELNYX_API_KEY", "")

SMS_RETRY_DELAYS = [30, 60, 120]  # seconds (3 retries with exponential backoff)


async def send_sms(
    db,
    business_id,
    call_log_id: Optional[str],
    to_number: str,
    from_number: str,
    body: str,
) -> dict:
    """Send SMS with retry logic (3 retries: 30s, 60s, 120s backoff)."""
    from db.connection import get_db

    sms_id = await db.fetchval(
        """
        INSERT INTO sms_logs (business_id, call_log_id, direction, to_number, from_number, body, status)
        VALUES ($1, $2::uuid, 'outbound', $3, $4, $5, 'queued')
        RETURNING id
        """,
        business_id,
        call_log_id,
        to_number,
        from_number,
        body,
    )

    for attempt, delay in enumerate([0] + SMS_RETRY_DELAYS):
        if delay > 0:
            await asyncio.sleep(delay)

        try:
            resp = telnyx.Message.create(
                from_=from_number,
                to=to_number,
                text=body,
            )
            msg_id = resp.get("data", {}).get("id")

            await db.execute(
                "UPDATE sms_logs SET status='sent', telnyx_msg_id=$1, attempts=$2 WHERE id=$3",
                msg_id,
                attempt + 1,
                sms_id,
            )
            return {"status": "sent", "telnyx_msg_id": msg_id}

        except Exception as e:
            if attempt == len(SMS_RETRY_DELAYS):
                # All retries exhausted
                await db.execute(
                    "UPDATE sms_logs SET status='failed', attempts=$1 WHERE id=$2",
                    attempt + 1,
                    sms_id,
                )
                await db.execute(
                    """
                    INSERT INTO audit_log (business_id, action, detail)
                    VALUES ($1, 'sms_failed',
                            jsonb_build_object('sms_id', $2::text, 'error', $3))
                    """,
                    business_id,
                    str(sms_id),
                    str(e),
                )
                return {"status": "failed", "error": str(e)}

    return {"status": "failed"}


TELNYX_SIP_CONNECTION_ID = os.environ.get("TELNYX_SIP_CONNECTION_ID", "")


async def search_available_numbers(
    country_code: str = "CA",
    area_code: str = "416",
    limit: int = 10,
) -> list[dict]:
    """Search for available phone numbers with voice+SMS capability."""
    loop = asyncio.get_event_loop()
    numbers = await loop.run_in_executor(
        None,
        lambda: telnyx.AvailablePhoneNumber.list(
            filter={
                "country_code": country_code,
                "area_code": area_code,
                "features": ["voice", "sms"],
            },
            page={"size": min(limit, 20)},
        ),
    )
    return [
        {
            "phone_number": n["phone_number"],
            "region": n.get("region_information", [{}])[0].get("region_name", ""),
            "city": n.get("region_information", [{}])[0].get("city", ""),
            "monthly_cost": n.get("cost_information", {}).get("monthly_cost", "1.00"),
        }
        for n in (numbers.data or [])
    ]


async def provision_phone_number(
    phone_number: str,
    connection_id: str = "",
) -> dict:
    """
    Purchase a specific phone number and assign it to the SIP connection.
    Returns {"phone_number": str, "number_id": str}.
    """
    loop = asyncio.get_event_loop()
    conn_id = connection_id or TELNYX_SIP_CONNECTION_ID

    # Step 1: Purchase the number via number order
    order = await loop.run_in_executor(
        None,
        lambda: telnyx.NumberOrder.create(
            phone_numbers=[{"phone_number": phone_number}],
        ),
    )
    order_data = order.get("data", {})
    if order_data.get("status") not in ("success", "pending"):
        raise ValueError(
            f"Number order failed: {order_data.get('status')} — "
            f"{order_data.get('requirements_status', 'unknown')}"
        )

    # Step 2: Assign to SIP connection so inbound calls route to LiveKit
    # The number needs a moment to be provisioned before we can update it
    await asyncio.sleep(2)
    try:
        await loop.run_in_executor(
            None,
            lambda: telnyx.PhoneNumber.update(
                phone_number,
                connection_id=conn_id,
            ),
        )
    except Exception:
        # Retry once after a short delay — provisioning can be async
        await asyncio.sleep(3)
        await loop.run_in_executor(
            None,
            lambda: telnyx.PhoneNumber.update(
                phone_number,
                connection_id=conn_id,
            ),
        )

    return {
        "phone_number": phone_number,
        "order_id": order_data.get("id", ""),
    }


async def originate_call(
    to_number: str,
    from_number: str,
    connection_id: str,
    webhook_url: str,
) -> str:
    """Place an outbound call. Returns call_sid."""
    resp = telnyx.Call.create(
        connection_id=connection_id,
        to=to_number,
        from_=from_number,
        webhook_url=webhook_url,
    )
    return resp["data"]["call_leg_id"]

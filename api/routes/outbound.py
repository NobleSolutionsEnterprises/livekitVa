import time
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel

from api.campaign_runner import enqueue_contact, is_on_dnc, is_in_tcpa_window
from api.dependencies import (
    get_business_or_404,
    get_db_dep,
    read_rate_limit,
    store_idempotency_result,
    verify_idempotency,
    verify_jwt,
    write_rate_limit,
)
from db.connection import get_redis

router = APIRouter(tags=["outbound"])


class SingleCallRequest(BaseModel):
    phone_number: str
    script: str


class CampaignCreateRequest(BaseModel):
    name: str
    script: str
    phone_numbers: list[str]
    scheduled_at: Optional[str] = None


@router.post(
    "/businesses/{business_id}/outbound/call",
    dependencies=[Depends(write_rate_limit)],
)
async def single_outbound_call(
    business_id: UUID,
    body: SingleCallRequest,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
    jwt=Depends(verify_jwt),
    idem_key: Optional[str] = Depends(verify_idempotency),
):
    # DNC check
    if await is_on_dnc(db, business_id, body.phone_number):
        raise HTTPException(status_code=400, detail="Number is on DNC list")

    # TCPA check
    if not await is_in_tcpa_window(business["timezone"]):
        raise HTTPException(status_code=400, detail="Outside TCPA calling hours (8am-9pm local)")

    contact_id = str(uuid4())
    redis = get_redis()
    score = time.time()
    await redis.zadd(f"outbound_queue:{business_id}", {contact_id: score})

    result = {"status": "queued", "contact_id": contact_id}
    await store_idempotency_result(idem_key, result)
    return result


@router.post(
    "/businesses/{business_id}/outbound/campaigns",
    dependencies=[Depends(write_rate_limit)],
)
async def create_campaign(
    business_id: UUID,
    body: CampaignCreateRequest,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
    jwt=Depends(verify_jwt),
    idem_key: Optional[str] = Depends(verify_idempotency),
):
    campaign_id = await db.fetchval(
        """
        INSERT INTO outbound_campaigns (business_id, name, script, scheduled_at, calls_total)
        VALUES ($1, $2, $3, $4::timestamptz, $5) RETURNING id
        """,
        business_id,
        body.name,
        body.script,
        body.scheduled_at,
        len(body.phone_numbers),
    )

    screened_out = 0
    enqueued = 0
    for number in body.phone_numbers:
        if await is_on_dnc(db, business_id, number):
            status = "skipped_dnc"
            screened_out += 1
        else:
            status = "pending"
            enqueued += 1

        await db.execute(
            "INSERT INTO campaign_contacts (campaign_id, phone_number, status) VALUES ($1, $2, $3)",
            campaign_id,
            number,
            status,
        )

        if status == "pending":
            await enqueue_contact(str(business_id), str(campaign_id), score=time.time())

    result = {
        "campaign_id": str(campaign_id),
        "total": len(body.phone_numbers),
        "enqueued": enqueued,
        "screened_out": screened_out,
    }
    await store_idempotency_result(idem_key, result)
    return result


@router.get(
    "/businesses/{business_id}/outbound/campaigns/{campaign_id}/contacts",
    dependencies=[Depends(read_rate_limit)],
)
async def list_campaign_contacts(
    business_id: UUID,
    campaign_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
    cursor: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    # Verify campaign belongs to this business
    campaign = await db.fetchrow(
        "SELECT id FROM outbound_campaigns WHERE id=$1 AND business_id=$2",
        campaign_id,
        business_id,
    )
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    params: list = [campaign_id]
    cursor_clause = ""
    if cursor:
        cursor_clause = "AND id > $2::uuid"
        params.append(cursor)

    params.append(limit + 1)
    rows = await db.fetch(
        f"""
        SELECT id, phone_number, status, outcome, attempts, next_retry_at, dlq_reason, called_at
        FROM campaign_contacts
        WHERE campaign_id = $1 {cursor_clause}
        ORDER BY id
        LIMIT ${len(params)}
        """,
        *params,
    )

    items = []
    for r in rows[:limit]:
        d = dict(r)
        d["id"] = str(d["id"])
        if d.get("next_retry_at"):
            d["next_retry_at"] = d["next_retry_at"].isoformat()
        if d.get("called_at"):
            d["called_at"] = d["called_at"].isoformat()
        items.append(d)

    next_cursor = str(rows[limit - 1]["id"]) if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor}


@router.get(
    "/businesses/{business_id}/outbound/campaigns/{campaign_id}/dlq",
    dependencies=[Depends(read_rate_limit)],
)
async def list_dlq(
    business_id: UUID,
    campaign_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    campaign = await db.fetchrow(
        "SELECT id FROM outbound_campaigns WHERE id=$1 AND business_id=$2",
        campaign_id, business_id,
    )
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    rows = await db.fetch(
        """
        SELECT id, phone_number, status, dlq_reason, attempts, called_at
        FROM campaign_contacts
        WHERE campaign_id=$1 AND status='dlq'
        ORDER BY called_at DESC
        """,
        campaign_id,
    )
    items = []
    for r in rows:
        d = dict(r)
        d["id"] = str(d["id"])
        if d.get("called_at"):
            d["called_at"] = d["called_at"].isoformat()
        items.append(d)
    return {"items": items}


@router.post(
    "/businesses/{business_id}/outbound/campaigns/{campaign_id}/dlq/retry",
    dependencies=[Depends(write_rate_limit)],
)
async def retry_dlq(
    business_id: UUID,
    campaign_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    campaign = await db.fetchrow(
        "SELECT id FROM outbound_campaigns WHERE id=$1 AND business_id=$2",
        campaign_id, business_id,
    )
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    dlq_rows = await db.fetch(
        "SELECT id FROM campaign_contacts WHERE campaign_id=$1 AND status='dlq'",
        campaign_id,
    )
    count = 0
    for row in dlq_rows:
        await db.execute(
            "UPDATE campaign_contacts SET status='pending', attempts=0, dlq_reason=NULL WHERE id=$1",
            row["id"],
        )
        await enqueue_contact(str(business_id), str(row["id"]), score=time.time())
        count += 1

    return {"retried": count}

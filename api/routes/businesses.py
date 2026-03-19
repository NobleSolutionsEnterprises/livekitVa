from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.dependencies import (
    get_business_or_404,
    get_db_dep,
    read_rate_limit,
    verify_jwt,
    write_rate_limit,
    JWTPayload,
    JWT_SECRET,
    JWT_ALGORITHM,
)
from api.gdpr import erase_business_data

router = APIRouter(tags=["businesses"])


def validate_timezone(tz: str) -> str:
    try:
        ZoneInfo(tz)
        return tz
    except (ZoneInfoNotFoundError, KeyError):
        raise HTTPException(status_code=400, detail=f"Invalid IANA timezone: {tz}")


class NumberSearchParams(BaseModel):
    country_code: str = "CA"
    area_code: str = "416"
    limit: int = 10


class ProvisionNumberRequest(BaseModel):
    phone_number: str  # E.164 format, from search results


class BusinessCreate(BaseModel):
    name: str
    did: Optional[str] = None  # Optional — can provision via /provision-number instead
    greeting: str
    persona: str
    timezone: str = "UTC"
    voice: str = "alloy"
    transfer_number: Optional[str] = None
    after_hours_number: Optional[str] = None
    after_hours_greeting: Optional[str] = None
    business_hours: Optional[dict] = None
    max_concurrent_calls: int = 5
    max_calls_per_caller_hour: int = 10
    rag_semantic_weight: float = 0.7
    chunk_size_tokens: int = 512
    chunk_overlap_tokens: int = 64
    recording_enabled: bool = True
    sms_enabled: bool = False
    calendar_enabled: bool = False
    data_retention_days: int = 90
    widget_enabled: bool = False
    widget_allowed_domains: list[str] = []
    widget_chat_greeting: Optional[str] = None
    widget_accent_color: str = "#2563eb"


class BusinessPatch(BaseModel):
    name: Optional[str] = None
    greeting: Optional[str] = None
    persona: Optional[str] = None
    timezone: Optional[str] = None
    voice: Optional[str] = None
    transfer_number: Optional[str] = None
    after_hours_number: Optional[str] = None
    after_hours_greeting: Optional[str] = None
    business_hours: Optional[dict] = None
    max_concurrent_calls: Optional[int] = None
    max_calls_per_caller_hour: Optional[int] = None
    rag_semantic_weight: Optional[float] = None
    chunk_size_tokens: Optional[int] = None
    chunk_overlap_tokens: Optional[int] = None
    sms_enabled: Optional[bool] = None
    sms_postcall_template: Optional[str] = None
    sms_reminder_template: Optional[str] = None
    calendar_enabled: Optional[bool] = None
    data_retention_days: Optional[int] = None
    widget_enabled: Optional[bool] = None
    widget_allowed_domains: Optional[list[str]] = None
    widget_chat_greeting: Optional[str] = None
    widget_accent_color: Optional[str] = None


class FeatureFlagUpdate(BaseModel):
    flag: str
    enabled: bool


def _serialize_business(row) -> dict:
    d = dict(row)
    d["id"] = str(d["id"])
    d["owner_id"] = str(d["owner_id"])
    d.pop("calendar_oauth_token_enc", None)  # never expose encrypted token
    if d.get("created_at"):
        d["created_at"] = d["created_at"].isoformat()
    return d


@router.post("/businesses")
async def create_business(
    body: BusinessCreate,
    db=Depends(get_db_dep),
    jwt: JWTPayload = Depends(verify_jwt),
):
    # No rate limiter here — new users don't have business_id yet.
    # JWT is still required (user must be signed up).
    validate_timezone(body.timezone)
    import json
    row = await db.fetchrow(
        """
        INSERT INTO businesses
          (owner_id, name, did, greeting, persona, timezone, voice,
           transfer_number, after_hours_number, after_hours_greeting, business_hours,
           max_concurrent_calls, max_calls_per_caller_hour, rag_semantic_weight,
           chunk_size_tokens, chunk_overlap_tokens, recording_enabled,
           sms_enabled, calendar_enabled, data_retention_days,
           widget_enabled, widget_allowed_domains, widget_chat_greeting, widget_accent_color)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13,
                $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        RETURNING *
        """,
        jwt.user_id,
        body.name,
        body.did,
        body.greeting,
        body.persona,
        body.timezone,
        body.voice,
        body.transfer_number,
        body.after_hours_number,
        body.after_hours_greeting,
        json.dumps(body.business_hours) if body.business_hours else None,
        body.max_concurrent_calls,
        body.max_calls_per_caller_hour,
        body.rag_semantic_weight,
        body.chunk_size_tokens,
        body.chunk_overlap_tokens,
        body.recording_enabled,
        body.sms_enabled,
        body.calendar_enabled,
        body.data_retention_days,
        body.widget_enabled,
        body.widget_allowed_domains,
        body.widget_chat_greeting,
        body.widget_accent_color,
    )

    # Issue a new JWT that includes the business_id
    import time
    import jwt as pyjwt
    now = int(time.time())
    new_token = pyjwt.encode(
        {"sub": jwt.user_id, "business_id": str(row["id"]), "iat": now, "exp": now + 86400},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )

    result = _serialize_business(row)
    result["token"] = new_token
    return result


@router.get(
    "/businesses/{business_id}",
    dependencies=[Depends(read_rate_limit)],
)
async def get_business(
    business_id: UUID,
    business=Depends(get_business_or_404),
):
    return _serialize_business(business)


@router.patch(
    "/businesses/{business_id}",
    dependencies=[Depends(write_rate_limit)],
)
async def update_business(
    business_id: UUID,
    body: BusinessPatch,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    import json
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return _serialize_business(business)

    if "timezone" in updates:
        validate_timezone(updates["timezone"])

    if "business_hours" in updates:
        updates["business_hours"] = json.dumps(updates["business_hours"])

    set_clauses = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates.keys()))
    values = list(updates.values())

    row = await db.fetchrow(
        f"UPDATE businesses SET {set_clauses} WHERE id = $1 RETURNING *",
        business_id,
        *values,
    )
    return _serialize_business(row)


@router.delete(
    "/businesses/{business_id}/data",
    dependencies=[Depends(write_rate_limit)],
)
async def gdpr_erasure(
    business_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
    jwt: JWTPayload = Depends(verify_jwt),
):
    counts = await erase_business_data(business_id, jwt.user_id)
    return {"status": "erased", "counts": counts}


@router.get(
    "/businesses/{business_id}/flags",
    dependencies=[Depends(read_rate_limit)],
)
async def get_feature_flags(
    business_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    rows = await db.fetch(
        "SELECT flag, enabled, updated_at FROM business_feature_flags WHERE business_id=$1",
        business_id,
    )
    return {"flags": [{**dict(r), "updated_at": r["updated_at"].isoformat()} for r in rows]}


@router.patch(
    "/businesses/{business_id}/flags",
    dependencies=[Depends(write_rate_limit)],
)
async def update_feature_flag(
    business_id: UUID,
    body: FeatureFlagUpdate,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    VALID_FLAGS = {"enable_reranker", "use_groq", "allow_outbound_campaigns", "enable_semantic_chunking"}
    if body.flag not in VALID_FLAGS:
        raise HTTPException(status_code=400, detail=f"Unknown flag. Valid: {VALID_FLAGS}")

    await db.execute(
        """
        INSERT INTO business_feature_flags (business_id, flag, enabled)
        VALUES ($1, $2, $3)
        ON CONFLICT (business_id, flag)
        DO UPDATE SET enabled=$3, updated_at=NOW()
        """,
        business_id,
        body.flag,
        body.enabled,
    )
    return {"flag": body.flag, "enabled": body.enabled}


@router.get(
    "/businesses/{business_id}/available-numbers",
    dependencies=[Depends(read_rate_limit)],
)
async def search_available_numbers(
    business_id: UUID,
    country_code: str = "CA",
    area_code: str = "416",
    limit: int = 10,
    business=Depends(get_business_or_404),
):
    """Search available Telnyx phone numbers by area code."""
    from api.telnyx_client import search_available_numbers as _search

    if limit < 1 or limit > 20:
        raise HTTPException(status_code=400, detail="limit must be 1-20")

    try:
        numbers = await _search(
            country_code=country_code,
            area_code=area_code,
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Telnyx search failed: {e}")

    return {"numbers": numbers}


@router.post(
    "/businesses/{business_id}/provision-number",
    dependencies=[Depends(write_rate_limit)],
)
async def provision_number(
    business_id: UUID,
    body: ProvisionNumberRequest,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    """Purchase a phone number from Telnyx and assign it to this business."""
    from api.telnyx_client import provision_phone_number

    # Check if business already has a DID
    if business.get("did"):
        raise HTTPException(
            status_code=409,
            detail=f"Business already has a number: {business['did']}. "
            "Release the current number before provisioning a new one.",
        )

    try:
        result = await provision_phone_number(phone_number=body.phone_number)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Telnyx provisioning failed: {e}")

    # Update business with new DID
    row = await db.fetchrow(
        "UPDATE businesses SET did = $1 WHERE id = $2 RETURNING *",
        result["phone_number"],
        business_id,
    )

    # Audit log
    await db.execute(
        """
        INSERT INTO audit_log (business_id, action, detail)
        VALUES ($1, 'number_provisioned',
                jsonb_build_object('phone_number', $2, 'order_id', $3))
        """,
        business_id,
        result["phone_number"],
        result.get("order_id", ""),
    )

    return {
        "status": "provisioned",
        "phone_number": result["phone_number"],
        "business": _serialize_business(row),
    }

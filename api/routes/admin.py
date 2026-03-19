import asyncio
import os
import socket

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse

from api.dependencies import get_db_dep, verify_admin, verify_jwt, JWTPayload
from db.connection import get_db, get_redis

router = APIRouter(tags=["admin"])


@router.get("/admin/me")
async def admin_me(jwt: JWTPayload = Depends(verify_jwt)):
    return {"is_admin": jwt.is_admin}


@router.get("/health")
async def health():
    return {"status": "ok"}


async def _check_dns(host: str, timeout: float = 2.0) -> bool:
    try:
        loop = asyncio.get_event_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, lambda: socket.getaddrinfo(host, 443)),
            timeout=timeout,
        )
        return True
    except Exception:
        return False


@router.get("/ready")
async def ready(db=Depends(get_db_dep)):
    results: dict[str, str] = {}

    # PostgreSQL
    try:
        await db.fetchval("SELECT 1")
        results["postgres"] = "ok"
    except Exception as e:
        results["postgres"] = f"error: {e}"

    # Redis
    try:
        redis = get_redis()
        await redis.ping()
        results["redis"] = "ok"
    except Exception as e:
        results["redis"] = f"error: {e}"

    # External providers (DNS check only — no API calls)
    for name, host in [
        ("deepgram", "api.deepgram.com"),
        ("openai", "api.openai.com"),
        ("telnyx", "api.telnyx.com"),
    ]:
        ok = await _check_dns(host)
        results[name] = "ok" if ok else "unreachable"

    all_ok = all(v == "ok" for v in results.values())
    return JSONResponse(
        content={"status": "ready" if all_ok else "degraded", "checks": results},
        status_code=200 if all_ok else 503,
    )


async def _rotate_key_background():
    new_key = os.environ.get("NEW_ENCRYPTION_KEY")
    old_key = os.environ.get("ENCRYPTION_KEY")
    if not new_key or not old_key:
        return

    async with get_db() as db:
        rows = await db.fetch(
            "SELECT id FROM businesses WHERE calendar_oauth_token_enc IS NOT NULL"
        )
        for row in rows:
            await db.execute(
                """
                UPDATE businesses
                SET calendar_oauth_token_enc = pgp_sym_encrypt(
                    pgp_sym_decrypt(calendar_oauth_token_enc, $1),
                    $2
                )
                WHERE id = $3
                """,
                old_key,
                new_key,
                row["id"],
            )

        await db.execute(
            "INSERT INTO audit_log (action, detail) VALUES ('key_rotation', '{\"status\": \"completed\"}'::jsonb)"
        )


@router.post("/admin/rotate-key", dependencies=[Depends(verify_admin)])
async def rotate_key(background_tasks: BackgroundTasks):
    background_tasks.add_task(_rotate_key_background)
    return {"status": "rotation_started"}


# ── Admin-only endpoints ──────────────────────────────────────────────


@router.get("/admin/businesses")
async def list_all_businesses(
    jwt: JWTPayload = Depends(verify_admin),
    db=Depends(get_db_dep),
):
    rows = await db.fetch(
        """
        SELECT b.id, b.name, b.did, b.timezone, b.active, b.created_at,
               u.name AS owner_name, u.email AS owner_email
        FROM businesses b
        LEFT JOIN users u ON u.id = b.owner_id
        ORDER BY b.created_at DESC
        """
    )
    return [dict(r) for r in rows]


@router.get("/admin/users")
async def list_all_users(
    jwt: JWTPayload = Depends(verify_admin),
    db=Depends(get_db_dep),
):
    rows = await db.fetch(
        """
        SELECT id, name, email, is_admin, created_at
        FROM users
        ORDER BY created_at DESC
        """
    )
    return [dict(r) for r in rows]


@router.patch("/admin/users/{user_id}/admin")
async def toggle_user_admin(
    user_id: str,
    jwt: JWTPayload = Depends(verify_admin),
    db=Depends(get_db_dep),
):
    row = await db.fetchrow(
        "UPDATE users SET is_admin = NOT is_admin WHERE id = $1::uuid RETURNING id, name, email, is_admin",
        user_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


@router.get("/admin/businesses/{business_id}")
async def get_business_detail(
    business_id: str,
    jwt: JWTPayload = Depends(verify_admin),
    db=Depends(get_db_dep),
):
    row = await db.fetchrow(
        """
        SELECT b.*, u.name AS owner_name, u.email AS owner_email
        FROM businesses b
        LEFT JOIN users u ON u.id = b.owner_id
        WHERE b.id = $1::uuid
        """,
        business_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Business not found")
    return dict(row)


@router.delete("/admin/businesses/{business_id}")
async def deactivate_business(
    business_id: str,
    jwt: JWTPayload = Depends(verify_admin),
    db=Depends(get_db_dep),
):
    await db.execute(
        "UPDATE businesses SET active = FALSE WHERE id = $1::uuid",
        business_id,
    )
    return {"status": "deactivated"}

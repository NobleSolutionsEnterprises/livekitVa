import json
import os
import time
from typing import Optional
from uuid import UUID

import jwt as pyjwt
from fastapi import Depends, Header, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi import Request

from db.connection import get_db, get_redis

security = HTTPBearer(auto_error=False)
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALGORITHM = "HS256"


class JWTPayload:
    def __init__(self, business_id: str, user_id: str, is_admin: bool = False):
        self.business_id = business_id
        self.user_id = user_id
        self.is_admin = is_admin


async def verify_jwt(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
) -> JWTPayload:
    token = None
    if credentials:
        token = credentials.credentials
    elif "va_token" in request.cookies:
        token = request.cookies["va_token"]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    business_id = payload.get("business_id", "")
    user_id = payload.get("sub")
    is_admin = payload.get("is_admin", False)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token claims")

    return JWTPayload(business_id=business_id, user_id=user_id, is_admin=is_admin)


async def get_db_dep():
    async with get_db() as conn:
        yield conn


class RateLimiter:
    """Redis sliding window rate limiter. endpoint_type: 'read' | 'write' | 'upload'"""

    LIMITS = {
        "read": 60,
        "write": 10,
        "upload": 5,
    }

    def __init__(self, endpoint_type: str = "read"):
        self.endpoint_type = endpoint_type
        self.limit = self.LIMITS[endpoint_type]

    async def __call__(self, jwt: JWTPayload = Depends(verify_jwt)):
        if not jwt.business_id:
            raise HTTPException(status_code=403, detail="No business configured — create a business first")
        redis = get_redis()
        minute_bucket = int(time.time() // 60)
        key = f"rate:{jwt.business_id}:{self.endpoint_type}:{minute_bucket}"

        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 120)

        if count > self.limit:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded",
                headers={"Retry-After": "60"},
            )


read_rate_limit = RateLimiter("read")
write_rate_limit = RateLimiter("write")
upload_rate_limit = RateLimiter("upload")


async def verify_idempotency(
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    """Returns key if new, raises 200 with cached response if duplicate."""
    if not idempotency_key:
        return None

    redis = get_redis()
    redis_key = f"idem:{idempotency_key}"
    cached = await redis.get(redis_key)
    if cached:
        raise HTTPException(status_code=200, detail=json.loads(cached))

    return idempotency_key


async def store_idempotency_result(key: str, result: dict):
    if not key:
        return
    redis = get_redis()
    await redis.setex(f"idem:{key}", 86400, json.dumps(result))


async def verify_admin(jwt: JWTPayload = Depends(verify_jwt)) -> JWTPayload:
    if not jwt.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return jwt


async def get_business_or_404(
    business_id: UUID,
    db=Depends(get_db_dep),
    jwt: JWTPayload = Depends(verify_jwt),
):
    if str(business_id) != jwt.business_id and not jwt.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")

    row = await db.fetchrow(
        "SELECT * FROM businesses WHERE id = $1 AND active = TRUE",
        business_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Business not found")
    return row

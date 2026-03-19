import os
import time
from uuid import UUID

import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr

from api.dependencies import get_db_dep, JWT_SECRET, JWT_ALGORITHM, verify_jwt

router = APIRouter(tags=["auth"])

JWT_EXPIRY_SECONDS = int(os.environ.get("JWT_EXPIRY_SECONDS", "86400"))  # 24h default


class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


def _issue_jwt(user_id: str, business_id: str | None, is_admin: bool = False) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "business_id": business_id or "",
        "is_admin": is_admin,
        "iat": now,
        "exp": now + JWT_EXPIRY_SECONDS,
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@router.post("/auth/signup")
async def signup(body: SignupRequest, response: Response, db=Depends(get_db_dep)):
    # Check for existing user
    existing = await db.fetchval(
        "SELECT id FROM users WHERE email = $1", body.email
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Hash password with pgcrypto bcrypt
    user = await db.fetchrow(
        """
        INSERT INTO users (name, email, password_hash)
        VALUES ($1, $2, crypt($3, gen_salt('bf')))
        RETURNING id, email, name, is_admin, created_at
        """,
        body.name,
        body.email,
        body.password,
    )

    user_id = str(user["id"])
    token = _issue_jwt(user_id, business_id=None, is_admin=user["is_admin"])

    response.set_cookie(
        key="va_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_EXPIRY_SECONDS,
        path="/",
    )

    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": user["email"],
            "name": user["name"],
            "is_admin": user["is_admin"],
        },
        "business_id": None,
    }


@router.post("/auth/login")
async def login(body: LoginRequest, response: Response, db=Depends(get_db_dep)):
    row = await db.fetchrow(
        """
        SELECT id, email, name, password_hash, is_admin
        FROM users
        WHERE email = $1 AND password_hash = crypt($2, password_hash)
        """,
        body.email,
        body.password,
    )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_id = str(row["id"])

    # Find the user's business (if any)
    biz = await db.fetchrow(
        "SELECT id FROM businesses WHERE owner_id = $1 AND active = TRUE LIMIT 1",
        row["id"],
    )
    business_id = str(biz["id"]) if biz else None

    token = _issue_jwt(user_id, business_id, is_admin=row["is_admin"])

    response.set_cookie(
        key="va_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=JWT_EXPIRY_SECONDS,
        path="/",
    )

    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": row["email"],
            "name": row["name"],
            "is_admin": row["is_admin"],
        },
        "business_id": business_id,
    }

@router.get("/auth/me")
async def get_me(jwt=Depends(verify_jwt), db=Depends(get_db_dep)):
    row = await db.fetchrow(
        "SELECT id, email, name, is_admin FROM users WHERE id = $1", 
        jwt.user_id
    )
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
        
    return {
        "user": {
            "id": str(row["id"]),
            "email": row["email"],
            "name": row["name"],
            "is_admin": row["is_admin"],
        },
        "business_id": jwt.business_id if jwt.business_id else None,
    }


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("va_token", path="/")
    return {"status": "logged_out"}

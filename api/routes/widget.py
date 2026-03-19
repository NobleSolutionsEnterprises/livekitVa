"""
Widget endpoints — public (no JWT), IP-rate-limited.
Provides voice call tokens and chat sessions for embeddable web widgets.
"""
import json
import os
import time
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from db.connection import get_db, get_redis
from agent.conversation import ConversationEngine

router = APIRouter(tags=["widget"])

LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "wss://va-yo4kupeg.livekit.cloud")


# ---------------------------------------------------------------------------
# IP-based rate limiter (no JWT required)
# ---------------------------------------------------------------------------

class IPRateLimiter:
    def __init__(self, limit: int = 10, window: int = 60):
        self.limit = limit
        self.window = window

    async def check(self, ip: str):
        redis = get_redis()
        key = f"widget_rate:{ip}:{int(time.time()) // self.window}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, self.window * 2)
        if count > self.limit:
            raise HTTPException(429, "Rate limited")


_ip_limiter = IPRateLimiter(limit=10, window=60)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _validate_widget_business(business_id: str, request: Request) -> dict:
    """Validate business exists, is active, has widget enabled, and origin is allowed."""
    async with get_db() as db:
        business = await db.fetchrow(
            "SELECT * FROM businesses WHERE id=$1::uuid AND active=TRUE",
            business_id,
        )

    if not business:
        raise HTTPException(404, "Business not found")

    if not business.get("widget_enabled"):
        raise HTTPException(403, "Widget not enabled for this business")

    # Origin check — skip if allowed_domains is empty
    allowed_domains = business.get("widget_allowed_domains") or []
    if allowed_domains:
        origin = request.headers.get("origin", "")
        origin_host = origin.replace("https://", "").replace("http://", "").rstrip("/")
        if origin_host not in allowed_domains:
            raise HTTPException(403, "Origin not allowed")

    return business


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class TokenRequest(BaseModel):
    business_id: str


class ChatSessionRequest(BaseModel):
    business_id: str
    visitor_id: str


class ChatMessageRequest(BaseModel):
    message: str


# ---------------------------------------------------------------------------
# 1. POST /v1/widget/token — voice call token
# ---------------------------------------------------------------------------

@router.post("/widget/token")
async def widget_voice_token(body: TokenRequest, request: Request):
    client_ip = _get_client_ip(request)
    await _ip_limiter.check(client_ip)

    business = await _validate_widget_business(body.business_id, request)

    from livekit.api import AccessToken, VideoGrants, LiveKitAPI
    from livekit.protocol.room import CreateRoomRequest
    from livekit.protocol.agent_dispatch import CreateAgentDispatchRequest

    room_name = f"widget-{body.business_id}-{uuid4()}"
    room_metadata = json.dumps({
        "source": "widget",
        "business_id": str(body.business_id),
    })

    # Create room with metadata AND explicitly dispatch the agent.
    # SIP calls get auto-dispatched via trunk config, but widget rooms need explicit dispatch.
    lk_api = LiveKitAPI(
        url=LIVEKIT_URL.replace("wss://", "https://"),
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET,
    )
    try:
        await lk_api.room.create_room(
            CreateRoomRequest(name=room_name, metadata=room_metadata)
        )
        await lk_api.agent_dispatch.create_dispatch(
            CreateAgentDispatchRequest(
                room=room_name,
                agent_name="va-agent",
            )
        )
    finally:
        await lk_api.aclose()

    token = AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    token.with_identity(f"visitor-{uuid4()}")
    token.with_grants(VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
    ))

    return {
        "token": token.to_jwt(),
        "room_name": room_name,
        "livekit_url": LIVEKIT_URL,
    }


# ---------------------------------------------------------------------------
# 2. POST /v1/widget/chat/sessions — start chat
# ---------------------------------------------------------------------------

@router.post("/widget/chat/sessions")
async def create_chat_session(body: ChatSessionRequest, request: Request):
    client_ip = _get_client_ip(request)
    await _ip_limiter.check(client_ip)

    business = await _validate_widget_business(body.business_id, request)

    origin = request.headers.get("origin", "")

    async with get_db() as db:
        row = await db.fetchrow(
            """
            INSERT INTO chat_sessions
              (business_id, visitor_id, visitor_ip, origin_domain)
            VALUES ($1::uuid, $2, $3::inet, $4)
            RETURNING id
            """,
            body.business_id,
            body.visitor_id,
            client_ip,
            origin or None,
        )

    greeting = (
        business.get("widget_chat_greeting")
        or business["greeting"]
    )

    return {
        "session_id": str(row["id"]),
        "greeting": greeting,
    }


# ---------------------------------------------------------------------------
# 3. POST /v1/widget/chat/sessions/{session_id}/messages — send message
# ---------------------------------------------------------------------------

@router.post("/widget/chat/sessions/{session_id}/messages")
async def send_chat_message(session_id: UUID, body: ChatMessageRequest, request: Request):
    client_ip = _get_client_ip(request)
    await _ip_limiter.check(client_ip)

    async with get_db() as db:
        # Load session
        session = await db.fetchrow(
            "SELECT * FROM chat_sessions WHERE id=$1",
            session_id,
        )
        if not session:
            raise HTTPException(404, "Chat session not found")
        if session["outcome"] != "active":
            raise HTTPException(400, "Chat session is no longer active")

        # Load business
        business = await db.fetchrow(
            "SELECT * FROM businesses WHERE id=$1 AND active=TRUE",
            session["business_id"],
        )
        if not business:
            raise HTTPException(404, "Business not found")

        # Create engine and load existing history
        engine = ConversationEngine(
            business_id=str(session["business_id"]),
            session_id=str(session_id),
            session_type="chat",
        )

        # Load previous messages as conversation history
        history_rows = await db.fetch(
            "SELECT role, content FROM chat_messages WHERE session_id=$1 ORDER BY created_at",
            session_id,
        )
        history = [{"role": r["role"], "content": r["content"]} for r in history_rows]
        engine.load_history(history)

        # Generate response
        answer, usage_info = await engine.respond(db, body.message, dict(business))

        prompt_tokens = usage_info.get("prompt_tokens", 0)
        completion_tokens = usage_info.get("completion_tokens", 0)

        # Insert user message
        await db.execute(
            """
            INSERT INTO chat_messages (session_id, role, content)
            VALUES ($1, 'user', $2)
            """,
            session_id,
            body.message,
        )

        # Insert assistant message
        await db.execute(
            """
            INSERT INTO chat_messages (session_id, role, content, prompt_tokens, completion_tokens)
            VALUES ($1, 'assistant', $2, $3, $4)
            """,
            session_id,
            answer,
            prompt_tokens,
            completion_tokens,
        )

        # Update session message count
        await db.execute(
            "UPDATE chat_sessions SET message_count = message_count + 2 WHERE id=$1",
            session_id,
        )

    return {
        "response": answer,
        "session_id": str(session_id),
    }


# ---------------------------------------------------------------------------
# 4. GET /v1/widget/chat/sessions/{session_id}/messages — get history
# ---------------------------------------------------------------------------

@router.get("/widget/chat/sessions/{session_id}/messages")
async def get_chat_messages(session_id: UUID, request: Request):
    async with get_db() as db:
        session = await db.fetchrow(
            "SELECT id FROM chat_sessions WHERE id=$1",
            session_id,
        )
        if not session:
            raise HTTPException(404, "Chat session not found")

        rows = await db.fetch(
            "SELECT role, content, created_at FROM chat_messages WHERE session_id=$1 ORDER BY created_at",
            session_id,
        )

    messages = [
        {
            "role": r["role"],
            "content": r["content"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]

    return {"messages": messages}


# ---------------------------------------------------------------------------
# 5. POST /v1/widget/chat/sessions/{session_id}/end — end session
# ---------------------------------------------------------------------------

@router.post("/widget/chat/sessions/{session_id}/end")
async def end_chat_session(session_id: UUID, request: Request):
    async with get_db() as db:
        session = await db.fetchrow(
            "SELECT id, outcome FROM chat_sessions WHERE id=$1",
            session_id,
        )
        if not session:
            raise HTTPException(404, "Chat session not found")
        if session["outcome"] != "active":
            raise HTTPException(400, "Chat session is already ended")

        await db.execute(
            "UPDATE chat_sessions SET outcome='completed', ended_at=NOW() WHERE id=$1",
            session_id,
        )

    return {"status": "ended"}

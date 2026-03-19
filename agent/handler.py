"""
Call handler — orchestrates the full inbound call lifecycle.
v2.3: Caller rate limiting, business hours check, TTFT OTel span.
v2.4: Extracted RAG+LLM into ConversationEngine; CallHandler is now a thin wrapper.
"""
import os
import time
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from db.connection import get_redis
from agent.conversation import ConversationEngine


def _is_business_open(business_hours: Optional[dict], timezone_str: str) -> bool:
    """Check if current time is within business hours. Returns True if hours not configured (24/7)."""
    if not business_hours:
        return True

    try:
        tz = ZoneInfo(timezone_str)
        local_now = datetime.now(tz)
        day_name = local_now.strftime("%A").lower()
        hours = business_hours.get(day_name)
        if not hours:
            return False  # Closed today

        open_h, open_m = map(int, hours["open"].split(":"))
        close_h, close_m = map(int, hours["close"].split(":"))
        open_minutes = open_h * 60 + open_m
        close_minutes = close_h * 60 + close_m
        current_minutes = local_now.hour * 60 + local_now.minute

        return open_minutes <= current_minutes < close_minutes
    except Exception:
        return True  # Fail open — don't drop calls on config errors


async def check_caller_rate_limit(
    business_id: str,
    caller_number: str,
    max_calls: int,
) -> bool:
    """
    v2.3: Per-caller rate limiting via Redis counter.
    Key: caller_calls:{business_id}:{caller_number}, TTL: 1 hour rolling window.
    Returns True if within limit. Returns True if max_calls == 0 (disabled).
    """
    if max_calls == 0:
        return True

    redis = get_redis()
    key = f"caller_calls:{business_id}:{caller_number}"

    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 3600)  # 1-hour rolling window

    return count <= max_calls


async def check_concurrent_call_limit(business_id: str, max_concurrent: int) -> bool:
    """Increment active call counter. Returns True if within limit."""
    redis = get_redis()
    key = f"active_calls:{business_id}"
    count = await redis.incr(key)
    if count > max_concurrent:
        await redis.decr(key)
        return False
    return True


async def release_concurrent_call_slot(business_id: str) -> None:
    redis = get_redis()
    await redis.decr(f"active_calls:{business_id}")


class CallHandler:
    """Orchestrates a single inbound call's RAG conversation loop.
    Now delegates to ConversationEngine for the RAG+LLM pipeline."""

    def __init__(
        self,
        room_name: str,
        caller_number: str,
        business_id: str,
        call_log_id: str,
    ):
        self.room_name = room_name
        self.caller_number = caller_number
        self.business_id = business_id
        self.call_log_id = call_log_id
        self._engine = ConversationEngine(
            business_id=business_id,
            session_id=call_log_id,
            session_type="call",
        )

    @property
    def conversation_history(self) -> list[dict]:
        return self._engine.conversation_history

    @property
    def turn_index(self) -> int:
        return self._engine.turn_index

    async def handle_utterance(self, db, utterance: str, business: dict) -> str:
        """
        Process one caller utterance and return VA response text.
        Thin wrapper around ConversationEngine.respond().
        """
        answer, _usage_info = await self._engine.respond(db, utterance, business)
        return answer

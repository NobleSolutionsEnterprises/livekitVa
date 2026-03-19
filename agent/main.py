"""
LiveKit Agent Worker entrypoint.
v2.2: SIGTERM graceful shutdown — drain active calls before exiting.
v2.3: Caller rate limiting, business hours check integrated in CallHandler.
v2.4: Widget voice call support — browser-initiated calls via embeddable widget.
Updated for livekit-agents 1.x: VoiceAssistant → Agent + AgentSession.
"""
import asyncio
import json
import logging
import os
import signal
from uuid import uuid4

from livekit.agents import AgentSession, AutoSubscribe, JobContext, WorkerOptions, WorkerType, cli
from livekit.agents.llm import function_tool
from livekit.agents.voice import Agent
from livekit.plugins import openai as lk_openai, silero

from db.connection import close_db, close_redis, get_db, init_db, init_redis
from agent.handler import (
    CallHandler,
    _is_business_open,
    check_caller_rate_limit,
    check_concurrent_call_limit,
    release_concurrent_call_slot,
)
from agent.prompts import (
    AFTER_HOURS_GREETING,
    CONSENT_MESSAGE,
    OVERFLOW_MESSAGE,
    RATE_LIMITED_MESSAGE,
    build_system_prompt,
)
from agent.transfer import initiate_transfer

logger = logging.getLogger("va-platform.agent")

_shutting_down = False


def _handle_sigterm(*args):
    """v2.2: Graceful shutdown on SIGTERM — stop accepting new calls."""
    global _shutting_down
    logger.info("SIGTERM received — draining active calls (60s deadline)...")
    _shutting_down = True


signal.signal(signal.SIGTERM, _handle_sigterm)


def _build_transfer_tool(ctx: JobContext, transfer_number: str, call_log_id: str, session_ref: list, disconnect_event: asyncio.Event, business: dict):
    """Create a transfer_to_human function tool bound to this call's context."""
    _transfer_attempted = False

    @function_tool(
        name="transfer_to_human",
        description="Transfer the caller to a human team member. Use this when the caller explicitly asks to speak to a person, or when you cannot answer their question after trying. Only call this once per request.",
    )
    async def transfer_to_human(reason: str) -> str:
        """Transfer the call to a human agent.

        Args:
            reason: Brief reason for the transfer (e.g. "caller requested human agent", "unable to answer billing question")
        """
        nonlocal _transfer_attempted
        if _transfer_attempted:
            return "Transfer already attempted. Ask the caller if they'd like to leave a message or try again later."
        _transfer_attempted = True

        logger.info(f"Transfer initiated: room={ctx.room.name}, reason={reason}")

        if not transfer_number:
            logger.warning("No transfer number configured for this business")
            return "No transfer number is configured. Ask the caller to leave their contact information so someone can call them back."

        # Check business hours before attempting transfer
        biz_hours = business.get("business_hours")
        if isinstance(biz_hours, str):
            try:
                biz_hours = json.loads(biz_hours)
            except Exception:
                biz_hours = None
        if not _is_business_open(biz_hours, business.get("timezone", "UTC")):
            logger.info("Transfer blocked — outside business hours")
            return "The team is currently outside business hours. Ask the caller to leave their name and number so someone can call them back, or suggest they call again during business hours."

        # Update call log with transfer outcome
        async with get_db() as db:
            await db.execute(
                "UPDATE call_logs SET outcome='transferred' WHERE id=$1::uuid",
                call_log_id,
            )

        success = await initiate_transfer(
            room=ctx.room,
            transfer_number=transfer_number,
        )

        if success:
            # Stop the AI agent — human is now talking to the caller
            logger.info("Transfer connected — shutting down AI agent session")
            if session_ref[0]:
                try:
                    await session_ref[0].close()
                except Exception as e:
                    logger.warning(f"Error closing session: {e}")
                session_ref[0] = None

            # Watch for transfer participant to hang up, then end the call
            transfer_identity = f"transfer-{transfer_number}"

            @ctx.room.on("participant_disconnected")
            def _on_transfer_hangup(participant):
                if participant.identity == transfer_identity:
                    logger.info("Transfer participant hung up — ending call")
                    disconnect_event.set()

            # Also disconnect if the original caller hangs up during the transfer
            @ctx.room.on("participant_disconnected")
            def _on_caller_hangup_during_transfer(participant):
                if participant.identity.startswith("visitor-") or participant.identity.startswith("sip-"):
                    logger.info("Caller hung up during transfer — ending call")
                    disconnect_event.set()

            return "TRANSFER_CONNECTED"
        else:
            _transfer_attempted = False  # Allow retry if it failed
            return "The team member didn't answer. Ask the caller if they'd like to leave a message or try again later."

    return transfer_to_human


class VABusinessAgent(Agent):
    """Business-specific voice agent — greets caller on enter."""

    def __init__(self, business: dict, handler: CallHandler):
        super().__init__(
            instructions=build_system_prompt(
                business_name=business["name"],
                persona=business["persona"],
                context_chunks=[],
            )
        )
        self._business = business
        self._handler = handler

    async def on_enter(self):
        greeting = self._business["greeting"]
        logger.info(f"on_enter — greeting: {greeting[:50]}...")
        await self.session.say(greeting, allow_interruptions=True)


async def entrypoint(ctx: JobContext):
    """Main LiveKit agent entrypoint — called per room/call."""
    await init_db()
    await init_redis()

    if _shutting_down:
        logger.info("Worker is shutting down — rejecting new call")
        return

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Extract call metadata — try SIP participant attributes first, then room metadata
    business_did = ""
    caller_number = "unknown"
    is_widget_call = False

    # Wait briefly for SIP participant to fully connect
    await asyncio.sleep(1)

    # Log all participants and their attributes for debugging
    logger.info(f"Room participants: {len(ctx.room.remote_participants)}")
    for pid, p in ctx.room.remote_participants.items():
        logger.info(f"Participant {pid}: identity={p.identity}, name={p.name}, kind={p.kind}, attrs={dict(p.attributes or {})}")
        attrs = p.attributes or {}
        # LiveKit SIP sets these attributes on the SIP participant
        sip_did = attrs.get("sip.trunkPhoneNumber", "") or attrs.get("sip.trunk_phone_number", "")
        sip_caller = attrs.get("sip.phoneNumber", "") or attrs.get("sip.phone_number", "")
        if sip_did or sip_caller:
            business_did = sip_did
            caller_number = sip_caller or "unknown"
            logger.info(f"SIP participant: did={business_did}, caller={caller_number}")
            break

    # Fallback to room metadata (for API-dispatched calls)
    if not business_did:
        room_metadata = ctx.room.metadata or "{}"
        try:
            metadata = json.loads(room_metadata)
        except json.JSONDecodeError:
            metadata = {}

        # Check if this is a widget-initiated voice call
        if metadata.get("source") == "widget":
            is_widget_call = True
            business_id_from_meta = metadata.get("business_id", "")
            caller_number = "widget-visitor"
            logger.info(f"Widget voice call detected: business_id={business_id_from_meta}")

            if not business_id_from_meta:
                logger.warning("Widget call missing business_id in metadata")
                return

            async with get_db() as db:
                business = await db.fetchrow(
                    "SELECT * FROM businesses WHERE id=$1::uuid AND active=TRUE",
                    business_id_from_meta,
                )

            if not business:
                logger.warning(f"No active business found for widget call: {business_id_from_meta}")
                return

        else:
            business_did = metadata.get("did") or metadata.get("to", "")
            caller_number = metadata.get("caller_number") or metadata.get("from", caller_number)
            logger.info(f"Room metadata fallback: did={business_did}, caller={caller_number}, raw={room_metadata}")

    # Standard SIP/API path: look up by DID
    if not is_widget_call:
        async with get_db() as db:
            business = await db.fetchrow(
                "SELECT * FROM businesses WHERE did=$1 AND active=TRUE",
                business_did,
            )

        if not business:
            logger.warning(f"No active business found for DID: {business_did}")
            return

    business_id = str(business["id"])
    call_log_id = str(uuid4())

    # Create call log record
    call_direction = "widget" if is_widget_call else "inbound"
    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO call_logs
              (id, business_id, business_name_snapshot, direction, caller_number, started_at)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, NOW())
            """,
            call_log_id,
            business_id,
            business["name"],
            call_direction,
            caller_number,
        )

    # Widget calls skip: business hours check, caller rate limiting, concurrent call check
    if not is_widget_call:
        # Parse business_hours JSONB
        biz_hours = business["business_hours"]
        if isinstance(biz_hours, str):
            try:
                biz_hours = json.loads(biz_hours)
            except Exception:
                biz_hours = None

        # Business hours check
        if not _is_business_open(biz_hours, business["timezone"]):
            logger.info(f"Call outside business hours for {business_id}")
            async with get_db() as db:
                await db.execute(
                    "UPDATE call_logs SET outcome='after_hours', ended_at=NOW() WHERE id=$1::uuid",
                    call_log_id,
                )
            return

        # Caller rate limiting
        within_rate_limit = await check_caller_rate_limit(
            business_id,
            caller_number,
            business["max_calls_per_caller_hour"],
        )
        if not within_rate_limit:
            logger.info(f"Caller rate limited: {caller_number} on business {business_id}")
            async with get_db() as db:
                await db.execute(
                    "UPDATE call_logs SET outcome='rate_limited', ended_at=NOW() WHERE id=$1::uuid",
                    call_log_id,
                )
            return

        # Concurrent call gate
        within_concurrent = await check_concurrent_call_limit(
            business_id,
            business["max_concurrent_calls"],
        )
        if not within_concurrent:
            logger.info(f"Concurrent call limit reached for {business_id}")
            async with get_db() as db:
                await db.execute(
                    "UPDATE call_logs SET outcome='overflow', ended_at=NOW() WHERE id=$1::uuid",
                    call_log_id,
                )
            return

    logger.info(f"Setting up handler for {business_id} (widget={is_widget_call})")

    handler = CallHandler(
        room_name=ctx.room.name,
        caller_number=caller_number,
        business_id=business_id,
        call_log_id=call_log_id,
    )

    # Wait for the remote participant (SIP caller or widget visitor) to leave
    disconnect = asyncio.Event()

    # Build transfer tool for this call (needs session_ref and disconnect event)
    transfer_number = business.get("transfer_number") or ""
    session_ref = [None]  # Mutable ref so transfer tool can close the session
    transfer_tool = _build_transfer_tool(ctx, transfer_number, call_log_id, session_ref, disconnect, dict(business))

    try:
        logger.info("Creating AgentSession with VAD, STT, LLM, TTS...")
        session = AgentSession(
            vad=silero.VAD.load(),
            stt=lk_openai.STT(model="gpt-4o-mini-transcribe"),
            llm=lk_openai.LLM(model=os.environ.get("LLM_MODEL", "gpt-4o-mini")),
            tts=lk_openai.TTS(
                model="gpt-4o-mini-tts",
                voice=business["voice"] or "alloy",
                speed=1.2,
                instructions="Always speak in English. Use a natural, conversational tone.",
            ),
            tools=[transfer_tool],
        )
        session_ref[0] = session

        logger.info("Starting AgentSession...")
        agent = VABusinessAgent(business=dict(business), handler=handler)
        await session.start(
            room=ctx.room,
            agent=agent,
        )
        logger.info("AgentSession started successfully")

        @ctx.room.on("participant_disconnected")
        def _on_leave(participant):
            logger.info(f"Participant left: {participant.identity}")
            # Only disconnect when the original caller/visitor leaves, not transfer participants
            if participant.identity.startswith("visitor-") or participant.identity.startswith("sip-"):
                disconnect.set()

        await disconnect.wait()
        logger.info("Disconnect event received, cleaning up")

        # Ensure session is fully closed before exiting
        if session_ref[0]:
            try:
                await session_ref[0].close()
            except Exception:
                pass
            session_ref[0] = None

    finally:
        # Only release concurrent call slot for non-widget calls (widget skips the gate)
        if not is_widget_call:
            await release_concurrent_call_slot(business_id)

        async with get_db() as db:
            await db.execute(
                """
                UPDATE call_logs
                SET ended_at=NOW(),
                    duration_sec=EXTRACT(EPOCH FROM (NOW() - started_at))::INT,
                    outcome=COALESCE(outcome, 'completed')
                WHERE id=$1::uuid
                """,
                call_log_id,
            )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            worker_type=WorkerType.ROOM,
            agent_name="va-agent",
        )
    )

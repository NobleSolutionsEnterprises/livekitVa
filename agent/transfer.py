"""
Human transfer module — LiveKit SIP Outbound + participant monitoring.
"""
import asyncio
import logging
import os
from datetime import timedelta
from typing import Optional

from opentelemetry import trace

logger = logging.getLogger("va-platform.transfer")
tracer = trace.get_tracer("va-platform.transfer")

# Outbound SIP trunk ID on LiveKit Cloud (created via API, routes through Telnyx)
SIP_OUTBOUND_TRUNK_ID = os.environ.get("SIP_OUTBOUND_TRUNK_ID", "ST_dXgiMzdxLdLv")


async def initiate_transfer(
    room,
    transfer_number: str,
) -> bool:
    """
    Dispatch LiveKit SIP Outbound participant to transfer_number.
    Monitors the SIP participant — returns True if they stay connected,
    False if they disconnect (rejected/no-answer).
    """
    livekit_url = os.environ.get("LIVEKIT_URL", "").replace("wss://", "https://")
    livekit_api_key = os.environ.get("LIVEKIT_API_KEY", "")
    livekit_api_secret = os.environ.get("LIVEKIT_API_SECRET", "")
    transfer_identity = f"transfer-{transfer_number}"

    with tracer.start_as_current_span("transfer.bridge") as span:
        span.set_attribute("transfer_number", transfer_number)
        span.set_attribute("room", room.name)

        try:
            from livekit.api import LiveKitAPI
            from livekit.protocol.sip import CreateSIPParticipantRequest

            lk_api = LiveKitAPI(
                url=livekit_url,
                api_key=livekit_api_key,
                api_secret=livekit_api_secret,
            )

            # Track if transfer participant disconnects
            transfer_left = asyncio.Event()

            @room.on("participant_disconnected")
            def _on_transfer_leave(participant):
                if participant.identity == transfer_identity:
                    logger.info(f"Transfer participant left: {participant.identity}")
                    transfer_left.set()

            try:
                logger.info(f"Creating SIP outbound to {transfer_number} in room {room.name}")
                await lk_api.sip.create_sip_participant(
                    CreateSIPParticipantRequest(
                        sip_trunk_id=SIP_OUTBOUND_TRUNK_ID,
                        sip_call_to=transfer_number,
                        room_name=room.name,
                        participant_identity=transfer_identity,
                        participant_name="Team Member",
                        play_ringtone=True,
                        ringing_timeout=timedelta(seconds=30),
                    )
                )
                logger.info("SIP outbound participant created, monitoring...")
            finally:
                await lk_api.aclose()

            # Wait for the transfer participant to actually join the room
            transfer_joined = asyncio.Event()

            @room.on("participant_connected")
            def _on_transfer_join(participant):
                if participant.identity == transfer_identity:
                    logger.info(f"Transfer participant joined: {participant.identity}")
                    transfer_joined.set()

            # Wait up to 35s for the human to pick up (ringing_timeout is 30s + buffer)
            try:
                await asyncio.wait_for(transfer_joined.wait(), timeout=35.0)
            except asyncio.TimeoutError:
                logger.warning("Transfer participant never joined — no answer")
                span.set_attribute("success", False)
                return False

            # Human picked up — now wait a moment to confirm they don't immediately hang up
            try:
                await asyncio.wait_for(transfer_left.wait(), timeout=3.0)
                logger.warning("Transfer participant left immediately after joining — rejected")
                span.set_attribute("success", False)
                return False
            except asyncio.TimeoutError:
                # Still connected after 3s = genuine pickup
                logger.info("Transfer participant connected and stable — transfer successful")
                span.set_attribute("success", True)
                return True

        except Exception as e:
            logger.error(f"Transfer failed: {e}", exc_info=True)
            span.set_attribute("error", str(e))
            return False


async def capture_voicemail(
    db,
    business_id: str,
    call_log_id: str,
    caller_number: Optional[str],
) -> None:
    """
    Record voicemail and store in voicemails table.
    Full implementation integrates with LiveKit recording API.
    """
    await db.execute(
        """
        INSERT INTO voicemails (business_id, call_log_id, caller_number)
        VALUES ($1::uuid, $2::uuid, $3)
        """,
        business_id,
        call_log_id,
        caller_number,
    )

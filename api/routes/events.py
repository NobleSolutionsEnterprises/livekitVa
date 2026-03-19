import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from api.dependencies import get_business_or_404, verify_jwt

router = APIRouter(tags=["events"])

# In-memory event queues per business
_event_queues: dict[str, list[asyncio.Queue]] = {}


def publish_event(business_id: str, event: dict):
    """Publish an event to all SSE subscribers for a business."""
    queues = _event_queues.get(business_id, [])
    for q in queues:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


@router.get("/businesses/{business_id}/events/stream")
async def event_stream(
    business_id: UUID,
    request: Request,
    business=Depends(get_business_or_404),
    jwt=Depends(verify_jwt),
):
    """SSE real-time event stream for the business dashboard."""
    biz_id = str(business_id)
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)

    if biz_id not in _event_queues:
        _event_queues[biz_id] = []
    _event_queues[biz_id].append(queue)

    async def generate():
        try:
            while True:
                if await request.is_disconnected():
                    break

                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Keepalive ping
                    yield ": keepalive\n\n"

        finally:
            _event_queues[biz_id].remove(queue)
            if not _event_queues[biz_id]:
                del _event_queues[biz_id]

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

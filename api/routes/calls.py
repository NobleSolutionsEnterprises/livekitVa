from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from api.dependencies import get_business_or_404, get_db_dep, read_rate_limit

router = APIRouter(tags=["calls"])


def _serialize_call(row) -> dict:
    d = dict(row)
    d["id"] = str(d["id"])
    if d.get("business_id"):
        d["business_id"] = str(d["business_id"])
    if d.get("campaign_id"):
        d["campaign_id"] = str(d["campaign_id"])
    for ts_field in ("started_at", "ended_at"):
        if d.get(ts_field):
            d[ts_field] = d[ts_field].isoformat()
    return d


@router.get(
    "/businesses/{business_id}/calls",
    dependencies=[Depends(read_rate_limit)],
)
async def list_calls(
    business_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
    cursor: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    direction: Optional[str] = Query(None),
    outcome: Optional[str] = Query(None),
):
    conditions = ["business_id = $1"]
    params: list = [business_id]
    idx = 2

    if direction:
        conditions.append(f"direction = ${idx}")
        params.append(direction)
        idx += 1

    if outcome:
        conditions.append(f"outcome = ${idx}")
        params.append(outcome)
        idx += 1

    if cursor:
        # cursor = "started_at_iso|id"
        try:
            cursor_ts, cursor_id = cursor.split("|")
            conditions.append(f"(started_at, id::text) < (${idx}::timestamptz, ${idx+1})")
            params.extend([cursor_ts, cursor_id])
            idx += 2
        except ValueError:
            pass

    where = " AND ".join(conditions)
    params.append(limit + 1)

    rows = await db.fetch(
        f"""
        SELECT id, business_id, direction, caller_number, started_at, ended_at,
               duration_sec, outcome, campaign_id
        FROM call_logs
        WHERE {where}
        ORDER BY started_at DESC, id DESC
        LIMIT ${idx}
        """,
        *params,
    )

    items = [_serialize_call(r) for r in rows[:limit]]
    next_cursor = None
    if len(rows) > limit:
        last = items[-1]
        next_cursor = f"{last['started_at']}|{last['id']}"

    return {"items": items, "next_cursor": next_cursor}


@router.get(
    "/businesses/{business_id}/calls/{call_id}/retrieval",
    dependencies=[Depends(read_rate_limit)],
)
async def get_call_retrieval(
    business_id: UUID,
    call_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    # Fetch retrieval audit rows for this call
    rows = await db.fetch(
        """
        SELECT ra.id, ra.turn_index, ra.utterance, ra.chunk_ids,
               ra.retrieval_scores, ra.model_used, ra.prompt_tokens,
               ra.completion_tokens, ra.retrieved_at
        FROM retrieval_audit ra
        WHERE ra.call_log_id = $1
        ORDER BY ra.turn_index ASC
        """,
        call_id,
    )

    turns = []
    for row in rows:
        # Join chunk content
        chunk_ids = row["chunk_ids"] or []
        chunks = []
        if chunk_ids:
            chunk_rows = await db.fetch(
                """
                SELECT id, content, metadata FROM document_chunks
                WHERE business_id = $1 AND id = ANY($2::uuid[])
                """,
                business_id,
                chunk_ids,
            )
            chunk_map = {str(c["id"]): c for c in chunk_rows}
            for cid in chunk_ids:
                c = chunk_map.get(str(cid))
                if c:
                    chunks.append({
                        "id": str(cid),
                        "content": c["content"],
                        "metadata": c["metadata"],
                        "scores": row["retrieval_scores"].get(str(cid), {}),
                    })

        turns.append({
            "turn_index": row["turn_index"],
            "utterance": row["utterance"],
            "chunks": chunks,
            "model_used": row["model_used"],
            "prompt_tokens": row["prompt_tokens"],
            "completion_tokens": row["completion_tokens"],
            "retrieved_at": row["retrieved_at"].isoformat() if row["retrieved_at"] else None,
        })

    return {"call_id": str(call_id), "turns": turns}

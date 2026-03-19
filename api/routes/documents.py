from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, UploadFile

from api.dependencies import (
    get_business_or_404,
    get_db_dep,
    read_rate_limit,
    upload_rate_limit,
)
from api.ingestion import ingest_document

router = APIRouter(tags=["documents"])


@router.post(
    "/businesses/{business_id}/documents",
    dependencies=[Depends(upload_rate_limit)],
)
async def upload_document(
    business_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    file_bytes = await file.read()

    # Check semantic chunking feature flag
    flag_row = await db.fetchrow(
        "SELECT enabled FROM business_feature_flags WHERE business_id=$1 AND flag='enable_semantic_chunking'",
        business_id,
    )
    semantic_chunking = bool(flag_row and flag_row["enabled"])

    # Run ingestion as a background task (returns immediately)
    background_tasks.add_task(
        ingest_document,
        db,
        business_id,
        file_bytes,
        file.filename,
        semantic_chunking,
    )

    return {"status": "processing", "filename": file.filename}


@router.get(
    "/businesses/{business_id}/documents",
    dependencies=[Depends(read_rate_limit)],
)
async def list_documents(
    business_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    rows = await db.fetch(
        """
        SELECT id, filename, file_type, status, ocr_applied, ocr_confidence,
               chunk_count, uploaded_at, error_message
        FROM documents
        WHERE business_id=$1
        ORDER BY uploaded_at DESC
        """,
        business_id,
    )

    docs = []
    for r in rows:
        ocr_quality = None
        if r["ocr_confidence"] is not None:
            ocr_quality = "low" if r["ocr_confidence"] < 0.6 else "ok"
        docs.append({
            "id": str(r["id"]),
            "filename": r["filename"],
            "file_type": r["file_type"],
            "status": r["status"],
            "ocr_applied": r["ocr_applied"],
            "ocr_quality": ocr_quality,
            "chunk_count": r["chunk_count"],
            "uploaded_at": r["uploaded_at"].isoformat() if r["uploaded_at"] else None,
            "error_message": r["error_message"],
        })

    return {"items": docs}

"""Unit tests for api/ingestion.py — dedup, chunking, semantic chunking, OCR threshold."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


def test_chunk_text_basic():
    from api.ingestion import chunk_text
    text = "word " * 600  # ~600 tokens
    chunks = chunk_text(text, size=512, overlap=64)
    assert len(chunks) >= 2
    assert all(len(c) > 0 for c in chunks)


def test_chunk_text_short_text():
    from api.ingestion import chunk_text
    text = "Short text."
    chunks = chunk_text(text, size=512, overlap=64)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_count_tokens():
    from api.ingestion import count_tokens
    assert count_tokens("hello world") > 0
    assert count_tokens("") == 0


def test_detect_type():
    from api.ingestion import detect_type
    assert detect_type("doc.pdf") == "pdf"
    assert detect_type("data.CSV") == "csv"
    assert detect_type("notes.txt") == "txt"
    assert detect_type("report.docx") == "docx"
    assert detect_type("notype") == ""


def test_chunk_text_semantic_no_headings():
    from api.ingestion import chunk_text_semantic
    text = "word " * 100
    chunks = chunk_text_semantic(text, headings=[], size=512, overlap=64)
    assert len(chunks) >= 1
    assert all("text" in c for c in chunks)


def test_chunk_text_semantic_with_heading():
    from api.ingestion import chunk_text_semantic
    headings = [{"text": "Section A"}]
    text = "Section A\n" + "word " * 50
    chunks = chunk_text_semantic(text, headings=headings, size=512, overlap=64)
    assert len(chunks) >= 1


def test_chunk_text_semantic_oversized_section():
    from api.ingestion import chunk_text_semantic
    headings = [{"text": "Big Section"}]
    text = "Big Section\n" + "word " * 600  # > 512 tokens
    chunks = chunk_text_semantic(text, headings=headings, size=512, overlap=64)
    # Should fall back to token chunking within the section
    assert len(chunks) >= 2


@pytest.mark.asyncio
async def test_ingest_unsupported_type():
    from api.ingestion import ingest_document
    from fastapi import HTTPException
    import pytest

    mock_db = AsyncMock()
    with pytest.raises(HTTPException) as exc_info:
        await ingest_document(mock_db, "biz-id", b"data", "file.xyz")
    assert exc_info.value.status_code == 400
    assert "Unsupported file type" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_ingest_dedup_returns_existing():
    from api.ingestion import ingest_document
    import hashlib

    file_bytes = b"test content"
    fingerprint = hashlib.sha256(file_bytes).hexdigest()

    mock_db = AsyncMock()
    mock_db.fetchrow.return_value = {"id": "existing-doc-id", "status": "ready"}

    result = await ingest_document(mock_db, "biz-id", file_bytes, "test.txt")
    assert result["reused"] is True
    assert result["document_id"] == "existing-doc-id"

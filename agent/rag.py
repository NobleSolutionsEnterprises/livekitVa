"""
RAG retrieval pipeline:
- Embedding cache (Redis, sha256(business_id+utterance) keyed, 1h TTL)
- Hybrid search: pgvector HNSW + pg_trgm via CTE
- Optional cross-encoder reranking
- Retrieval audit write
- OpenTelemetry spans
"""
import hashlib
import json
import os
import time
from typing import Optional

import openai
from opentelemetry import trace

from db.connection import get_db, get_redis

tracer = trace.get_tracer("va-platform.rag")

EMBEDDING_MODEL = "text-embedding-3-small"
EMBED_CACHE_TTL = 3600  # 1 hour
TOP_K = 5


def _embed_cache_key(business_id: str, utterance: str) -> str:
    return f"embed:{business_id}:" + hashlib.sha256(utterance.encode()).hexdigest()


async def get_embedding(business_id: str, utterance: str) -> list[float]:
    """Get embedding with Redis cache. Cache key namespaced by business_id (v2.2)."""
    redis = get_redis()
    cache_key = _embed_cache_key(business_id, utterance)

    with tracer.start_as_current_span("rag.embed") as span:
        cached = await redis.get(cache_key)
        if cached:
            span.set_attribute("cache_hit", True)
            return json.loads(cached)

        span.set_attribute("cache_hit", False)
        client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        resp = await client.embeddings.create(model=EMBEDDING_MODEL, input=utterance)
        embedding = resp.data[0].embedding

        await redis.setex(cache_key, EMBED_CACHE_TTL, json.dumps(embedding))
        return embedding


async def hybrid_search(
    db,
    business_id: str,
    utterance: str,
    embedding: list[float],
    semantic_weight: float = 0.7,
) -> list[dict]:
    """
    Hybrid HNSW semantic + pg_trgm keyword search via CTE (v2.2: CTE fixes alias in ORDER BY).
    Both scores are already in 0-1 range and are directly comparable.
    """
    with tracer.start_as_current_span("rag.retrieve") as span:
        # asyncpg can't cast list[float] to pgvector — pass as string
        embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"
        rows = await db.fetch(
            """
            WITH scored AS (
              SELECT
                id,
                content,
                metadata,
                (1 - (embedding <=> $1::vector))  AS semantic_score,
                similarity(content, $2)            AS keyword_score
              FROM document_chunks
              WHERE business_id = $3
            )
            SELECT
              id,
              content,
              metadata,
              semantic_score,
              keyword_score,
              (semantic_score * $4 + keyword_score * (1 - $4)) AS rrf_score
            FROM scored
            ORDER BY rrf_score DESC
            LIMIT $5
            """,
            embedding_str,
            utterance,
            business_id,
            semantic_weight,
            TOP_K,
        )
        span.set_attribute("chunk_count", len(rows))
        return [dict(r) for r in rows]


async def rerank(utterance: str, chunks: list[dict]) -> list[dict]:
    """Optional cross-encoder reranking (ms-marco-MiniLM-L-6-v2). Adds ~50ms."""
    with tracer.start_as_current_span("rag.rerank"):
        try:
            from sentence_transformers import CrossEncoder
            model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            pairs = [(utterance, c["content"]) for c in chunks]
            scores = model.predict(pairs)
            for chunk, score in zip(chunks, scores):
                chunk["rerank_score"] = float(score)
            return sorted(chunks, key=lambda c: c.get("rerank_score", 0.0), reverse=True)
        except Exception:
            return chunks  # Reranker failure is non-fatal


async def retrieve(
    db,
    business_id: str,
    utterance: str,
    semantic_weight: float = 0.7,
    use_reranker: bool = False,
) -> list[dict]:
    """Full retrieval: embed → cache → hybrid search → optional rerank."""
    embedding = await get_embedding(business_id, utterance)
    chunks = await hybrid_search(db, business_id, utterance, embedding, semantic_weight)
    if use_reranker and chunks:
        chunks = await rerank(utterance, chunks)
    return chunks


async def write_retrieval_audit(
    db,
    turn_index: int,
    utterance: str,
    chunks: list[dict],
    model_used: str,
    prompt_tokens: int,
    completion_tokens: int,
    call_log_id: Optional[str] = None,
    chat_session_id: Optional[str] = None,
) -> None:
    """Persist retrieval context for every LLM turn — enables debugging and RAG analytics.
    Supports both call and chat sessions via call_log_id / chat_session_id."""
    with tracer.start_as_current_span("rag.audit_write"):
        chunk_ids = [str(c["id"]) for c in chunks]
        retrieval_scores = {
            str(c["id"]): {
                "semantic": c.get("semantic_score", 0),
                "keyword": c.get("keyword_score", 0),
                "rrf": c.get("rrf_score", 0),
                "rerank": c.get("rerank_score"),
            }
            for c in chunks
        }
        await db.execute(
            """
            INSERT INTO retrieval_audit
              (call_log_id, chat_session_id, turn_index, utterance, chunk_ids, retrieval_scores,
               model_used, prompt_tokens, completion_tokens)
            VALUES ($1, $2, $3, $4, $5::uuid[], $6::jsonb, $7, $8, $9)
            """,
            call_log_id,
            chat_session_id,
            turn_index,
            utterance,
            chunk_ids,
            json.dumps(retrieval_scores),
            model_used,
            prompt_tokens,
            completion_tokens,
        )

"""
Trace Memory — persistent episodic store backed by Neon (asyncpg + pgvector).

Public API:
  store_trace(namespace, task_summary, outcome)  → None  (fire-and-forget)
  tool_recall(ctx, input: RecallInput)            → RecallOutput
"""
from __future__ import annotations

import os
from typing import TYPE_CHECKING

import asyncpg
from pydantic_ai import RunContext

from .deps import AgentDeps
from .schemas import PastTrace, RecallInput, RecallOutput

if TYPE_CHECKING:
    pass

_EMBED_MODEL = "text-embedding-3-small"
_EMBED_DIM = 1536
_openai = None


def _get_openai():
    global _openai
    if _openai is None:
        from openai import AsyncOpenAI
        _openai = AsyncOpenAI()
    return _openai


async def _embed(text: str) -> list[float]:
    """Return a 1536-dim embedding for *text* using OpenAI."""
    resp = await _get_openai().embeddings.create(
        model=_EMBED_MODEL,
        input=text,
    )
    return resp.data[0].embedding


async def store_trace(
    *,
    namespace: str,
    task_summary: str,
    outcome: str,
) -> None:
    """Embed *outcome* and insert a row into trace_memory. Never raises."""
    try:
        embedding = await _embed(outcome)
        vec = f"[{','.join(str(x) for x in embedding)}]"
        conn = await asyncpg.connect(os.environ.get("DATABASE_URL", ""))
        try:
            await conn.execute(
                """
                INSERT INTO trace_memory (namespace, task_summary, outcome, embedding)
                VALUES ($1, $2, $3, $4::vector)
                """,
                namespace,
                task_summary,
                outcome,
                vec,
            )
        finally:
            await conn.close()
    except Exception as exc:  # noqa: BLE001
        print(f"[Memory] store_trace failed (non-fatal): {exc}")


async def tool_recall(
    ctx: RunContext[AgentDeps],
    input: RecallInput,
) -> RecallOutput:
    """
    Semantic search over trace_memory for past tasks similar to *query*.
    Returns up to *top_k* results. Never raises.
    """
    try:
        embedding = await _embed(input.query)
        vec = f"[{','.join(str(x) for x in embedding)}]"
        conn = await asyncpg.connect(os.environ.get("DATABASE_URL", ""))
        try:
            namespace = ctx.deps.memory_namespace
            rows = await conn.fetch(
                """
                SELECT task_summary, outcome, created_at,
                       1 - (embedding <=> $1::vector) AS similarity
                FROM trace_memory
                WHERE namespace = $2
                ORDER BY embedding <=> $1::vector
                LIMIT $3
                """,
                vec,
                namespace,
                input.top_k,
            )
        finally:
            await conn.close()

        traces = [
            PastTrace(
                task=row["task_summary"],
                trace="",
                outcome=row["outcome"],
                created_at=str(row["created_at"]),
                similarity=float(row["similarity"]),
            )
            for row in rows
        ]
        return RecallOutput(memories=traces, namespace=namespace)
    except Exception as exc:  # noqa: BLE001
        print(f"[Memory] tool_recall failed (non-fatal): {exc}")
        return RecallOutput(memories=[], namespace="")

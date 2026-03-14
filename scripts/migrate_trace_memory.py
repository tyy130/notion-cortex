#!/usr/bin/env python3
"""
One-time migration: create trace_memory table with pgvector HNSW index.
Run from repo root: python scripts/migrate_trace_memory.py
"""
from __future__ import annotations
import asyncio
import os
from pathlib import Path

# Load .env — check worktree root first, then main repo root (worktrees share .git)
def _load_env(path: Path) -> None:
    if path.exists():
        for _line in path.read_text().splitlines():
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

_repo_root = Path(__file__).parent.parent
_load_env(_repo_root / ".env")
# Worktrees: main repo is two levels up from .worktrees/<name>
_main_repo = _repo_root.parent.parent
_load_env(_main_repo / ".env")

import asyncpg


async def migrate() -> None:
    url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(url)
    try:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS trace_memory (
                id          SERIAL PRIMARY KEY,
                namespace   TEXT        NOT NULL DEFAULT 'general',
                task_summary TEXT       NOT NULL,
                outcome     TEXT        NOT NULL,
                embedding   vector(1536),
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS trace_memory_embedding_idx
            ON trace_memory
            USING hnsw (embedding vector_cosine_ops);
        """)
        # Verify
        row = await conn.fetchrow(
            "SELECT COUNT(*) AS n FROM trace_memory;"
        )
        print(f"Migration complete. trace_memory rows: {row['n']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(migrate())

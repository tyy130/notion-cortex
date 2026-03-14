"""Tests for trace memory module (asyncpg + openai mocked)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def mock_conn():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=None)
    conn.fetch = AsyncMock(return_value=[])
    conn.execute = AsyncMock()
    return conn


@pytest.fixture
def mock_embedding():
    return [0.1] * 1536


# ── store_trace ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_store_trace_inserts_row(mock_conn, mock_embedding):
    """store_trace embeds the outcome and inserts a row."""
    with (
        patch("reasoning_agent.memory.asyncpg.connect", AsyncMock(return_value=mock_conn)),
        patch("reasoning_agent.memory._embed", AsyncMock(return_value=mock_embedding)),
    ):
        from reasoning_agent.memory import store_trace
        await store_trace(
            namespace="code",
            task_summary="Write a factorial function",
            outcome="def factorial(n): ...",
        )
    mock_conn.execute.assert_called_once()
    call_sql = mock_conn.execute.call_args[0][0]
    assert "INSERT INTO trace_memory" in call_sql


@pytest.mark.asyncio
async def test_store_trace_uses_namespace(mock_conn, mock_embedding):
    """namespace is passed to the INSERT statement."""
    with (
        patch("reasoning_agent.memory.asyncpg.connect", AsyncMock(return_value=mock_conn)),
        patch("reasoning_agent.memory._embed", AsyncMock(return_value=mock_embedding)),
    ):
        from reasoning_agent.memory import store_trace
        await store_trace(namespace="research", task_summary="t", outcome="o")
    args = mock_conn.execute.call_args[0]
    assert "research" in args


# ── tool_recall ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tool_recall_returns_past_traces(mock_conn, mock_embedding):
    """tool_recall queries pgvector and returns PastTrace objects."""
    fake_row = {
        "task_summary": "Write a factorial function",
        "outcome": "def factorial(n): ...",
        "created_at": "2026-01-01T00:00:00Z",
        "similarity": 0.95,
    }
    mock_conn.fetch = AsyncMock(return_value=[fake_row])

    with (
        patch("reasoning_agent.memory.asyncpg.connect", AsyncMock(return_value=mock_conn)),
        patch("reasoning_agent.memory._embed", AsyncMock(return_value=mock_embedding)),
    ):
        from reasoning_agent.memory import RecallInput, tool_recall
        from reasoning_agent.deps import AgentDeps
        from reasoning_agent.state import StateManager

        sm = MagicMock(spec=StateManager)
        deps = AgentDeps(state_manager=sm)

        ctx = MagicMock()
        ctx.deps = deps

        result = await tool_recall(ctx, RecallInput(query="factorial", top_k=3, rationale="test"))

    assert len(result.memories) == 1
    assert result.memories[0].task == "Write a factorial function"


@pytest.mark.asyncio
async def test_tool_recall_empty_when_no_rows(mock_conn, mock_embedding):
    """tool_recall returns empty list when no similar traces found."""
    mock_conn.fetch = AsyncMock(return_value=[])
    with (
        patch("reasoning_agent.memory.asyncpg.connect", AsyncMock(return_value=mock_conn)),
        patch("reasoning_agent.memory._embed", AsyncMock(return_value=mock_embedding)),
    ):
        from reasoning_agent.memory import RecallInput, tool_recall
        from reasoning_agent.deps import AgentDeps
        from reasoning_agent.state import StateManager

        sm = MagicMock(spec=StateManager)
        deps = AgentDeps(state_manager=sm)
        ctx = MagicMock()
        ctx.deps = deps

        result = await tool_recall(ctx, RecallInput(query="xyz", top_k=5, rationale="test"))

    assert result.memories == []


@pytest.mark.asyncio
async def test_store_trace_graceful_on_error(mock_conn):
    """store_trace does NOT raise on DB error — graceful degradation."""
    mock_conn.execute = AsyncMock(side_effect=Exception("DB down"))
    with (
        patch("reasoning_agent.memory.asyncpg.connect", AsyncMock(return_value=mock_conn)),
        patch("reasoning_agent.memory._embed", AsyncMock(return_value=[0.1] * 1536)),
    ):
        from reasoning_agent.memory import store_trace
        # Should not raise
        await store_trace(namespace="n", task_summary="t", outcome="o")


@pytest.mark.asyncio
async def test_tool_recall_graceful_on_error(mock_conn):
    """tool_recall returns empty RecallOutput on error — graceful degradation."""
    mock_conn.fetch = AsyncMock(side_effect=Exception("DB down"))
    with (
        patch("reasoning_agent.memory.asyncpg.connect", AsyncMock(return_value=mock_conn)),
        patch("reasoning_agent.memory._embed", AsyncMock(return_value=[0.1] * 1536)),
    ):
        from reasoning_agent.memory import RecallInput, tool_recall
        from reasoning_agent.deps import AgentDeps
        from reasoning_agent.state import StateManager

        sm = MagicMock(spec=StateManager)
        deps = AgentDeps(state_manager=sm)
        ctx = MagicMock()
        ctx.deps = deps

        result = await tool_recall(ctx, RecallInput(query="anything", top_k=3, rationale="test"))

    assert result.memories == []

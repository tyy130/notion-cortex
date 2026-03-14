# tests/test_schemas.py
"""Smoke tests — verify new schema types validate correctly."""
import pytest
import pydantic
from datetime import datetime, timezone
from reasoning_agent.schemas import (
    ActionType,
    TaskIntent,
    EnvScope,
    ContextShard,
    TaskContext,
    SearchInput,
    SearchOutput,
    SearchResult,
    RecallInput,
    RecallOutput,
    PastTrace,
)


def test_action_type_has_search_and_recall():
    assert ActionType.SEARCH == "search"
    assert ActionType.RECALL == "recall"


def test_task_intent_values():
    assert TaskIntent.RESEARCH == "research"
    assert TaskIntent.CODE == "code"
    assert TaskIntent.GENERAL == "general"


def test_env_scope_values():
    assert EnvScope.LOCAL_FILES == "local_files"
    assert EnvScope.EXTERNAL_WEB == "external_web"
    assert EnvScope.DATABASE == "database"
    assert EnvScope.MIXED == "mixed"


def test_task_context_namespace_default():
    ctx = TaskContext(intent=TaskIntent.CODE, env_scope=EnvScope.LOCAL_FILES)
    assert ctx.memory_namespace == "code"


def test_task_context_explicit_namespace():
    ctx = TaskContext(
        intent=TaskIntent.RESEARCH,
        env_scope=EnvScope.EXTERNAL_WEB,
        memory_namespace="custom",
    )
    assert ctx.memory_namespace == "custom"


def test_context_shard_model():
    s = ContextShard(source="README.md", content="# My Project", shard_type="readme")
    assert s.shard_type == "readme"


def test_search_input_requires_rationale():
    with pytest.raises(pydantic.ValidationError):
        SearchInput(query="test")  # missing rationale


def test_search_input_max_results_capped():
    with pytest.raises(pydantic.ValidationError):
        SearchInput(query="test", rationale="r", max_results=11)


def test_past_trace_model():
    t = PastTrace(
        task="test task",
        trace="[execute:read] read file",
        outcome="done",
        similarity=0.92,
        created_at=datetime.now(timezone.utc),
    )
    assert t.similarity == 0.92

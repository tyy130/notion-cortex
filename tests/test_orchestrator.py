# tests/test_orchestrator.py
"""
Tests for the Domain Context Engine orchestrator.

All pure sync — no event loop, no API calls.
Uses tmp_path to isolate file system operations.
"""
import pytest
from pathlib import Path
from reasoning_agent.orchestrator import (
    _classify_intent,
    _scan_shards,
    _detect_env_scope,
    build_context,
)
from reasoning_agent.schemas import TaskIntent, EnvScope, TaskContext


# ── Intent classification ──────────────────────────────────────────────────

def test_classify_intent_research():
    assert _classify_intent("research the market trends for AI tools") == TaskIntent.RESEARCH


def test_classify_intent_code():
    assert _classify_intent("fix the bug in auth.py") == TaskIntent.CODE


def test_classify_intent_sysadmin():
    assert _classify_intent("install docker and configure the server") == TaskIntent.SYSADMIN


def test_classify_intent_data():
    assert _classify_intent("query the database and update the schema") == TaskIntent.DATA


def test_classify_intent_general():
    assert _classify_intent("hello there") == TaskIntent.GENERAL


def test_classify_intent_picks_highest_scoring():
    # "analyze" (RESEARCH=1) + "database" + "sql" + "table" (DATA=3) — DATA wins 3 vs 1
    assert _classify_intent("analyze the sql database table") == TaskIntent.DATA


# ── Shard scanning ────────────────────────────────────────────────────────

def test_scan_shards_empty_dir(tmp_path):
    result = _scan_shards(tmp_path)
    assert result == []


def test_scan_shards_finds_readme(tmp_path):
    (tmp_path / "README.md").write_text("# My Project\nA Python tool.")
    shards = _scan_shards(tmp_path)
    assert len(shards) == 1
    assert shards[0].source == "README.md"
    assert shards[0].shard_type == "readme"
    assert "My Project" in shards[0].content


def test_scan_shards_finds_schema_sql(tmp_path):
    (tmp_path / "schema.sql").write_text("CREATE TABLE users (id SERIAL PRIMARY KEY);")
    shards = _scan_shards(tmp_path)
    assert any(s.shard_type == "schema" for s in shards)


def test_scan_shards_content_truncated_at_200(tmp_path):
    (tmp_path / "README.md").write_text("x" * 500)
    shards = _scan_shards(tmp_path)
    assert len(shards[0].content) <= 200


# ── EnvScope detection ────────────────────────────────────────────────────

def test_env_scope_research_no_files():
    assert _detect_env_scope(TaskIntent.RESEARCH, []) == EnvScope.EXTERNAL_WEB


def test_env_scope_data_with_schema(tmp_path):
    from reasoning_agent.schemas import ContextShard
    schema_shard = ContextShard(source="schema.sql", content="CREATE TABLE...", shard_type="schema")
    assert _detect_env_scope(TaskIntent.DATA, [schema_shard]) == EnvScope.DATABASE


def test_env_scope_code_with_readme(tmp_path):
    from reasoning_agent.schemas import ContextShard
    readme_shard = ContextShard(source="README.md", content="# Project", shard_type="readme")
    assert _detect_env_scope(TaskIntent.CODE, [readme_shard]) == EnvScope.LOCAL_FILES


# ── Integration ───────────────────────────────────────────────────────────

def test_build_context_integration(tmp_path):
    (tmp_path / "README.md").write_text("# DataPipeline\nETL system for CSV ingestion.")
    ctx = build_context("query the database and fix the sql bug", cwd=tmp_path)
    assert isinstance(ctx, TaskContext)
    assert ctx.intent in (TaskIntent.CODE, TaskIntent.DATA)
    assert len(ctx.context_shards) >= 1
    assert ctx.memory_namespace in ("code", "data")
    assert "Intent:" in ctx.dynamic_prompt

# tests/test_deps.py
"""Tests for AgentDeps __post_init__ namespace derivation."""
import pytest
from pathlib import Path
from reasoning_agent.deps import AgentDeps
from reasoning_agent.schemas import TaskContext, TaskIntent, EnvScope
from reasoning_agent.state import StateManager


@pytest.fixture
def sm(tmp_path):
    s = StateManager(tmp_path / "state.json")
    s.load_or_create("test task")
    return s


def test_namespace_derived_from_task_context(sm):
    ctx = TaskContext(intent=TaskIntent.CODE, env_scope=EnvScope.LOCAL_FILES)
    deps = AgentDeps(state_manager=sm, task_context=ctx)
    assert deps.memory_namespace == "code"


def test_namespace_defaults_to_general_without_context(sm):
    deps = AgentDeps(state_manager=sm)
    assert deps.memory_namespace == "general"

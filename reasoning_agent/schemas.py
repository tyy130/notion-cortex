"""
Pydantic schemas for the Plan-Preflight-Verify-Execute reasoning agent.

All tool inputs/outputs are typed models — no raw dicts or string parsing.
The Step model is the atomic unit logged to agent_state.json at every phase.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Loop phases
# ---------------------------------------------------------------------------

class LoopPhase(str, Enum):
    PLAN = "plan"
    PREFLIGHT = "preflight"
    VERIFY = "verify"
    EXECUTE = "execute"
    CLARIFY = "clarify"
    COMPLETE = "complete"


class ActionType(str, Enum):
    READ   = "read"
    WRITE  = "write"
    QUERY  = "query"
    SHELL  = "shell"
    SEARCH = "search"   # Phase 2 — Epistemic Forager
    RECALL = "recall"   # Phase 2 — Trace Memory


# ---------------------------------------------------------------------------
# Tool I/O — strict Pydantic models (no raw string parsing)
# ---------------------------------------------------------------------------

class ReadInput(BaseModel):
    resource_uri: str = Field(description="Absolute or relative path to read")
    encoding: str = Field(default="utf-8", description="File encoding")


class ReadOutput(BaseModel):
    content: str
    size_bytes: int
    resource_uri: str


class WriteInput(BaseModel):
    resource_uri: str = Field(description="Path to write")
    content: str = Field(description="Full content to write")
    mode: str = Field(
        default="overwrite",
        description="overwrite | append | create",
        pattern="^(overwrite|append|create)$",
    )
    rationale: str = Field(
        description="Agent MUST explain why this write is necessary. "
                    "Vague rationale (< 5 meaningful words) lowers the confidence score."
    )


class WriteOutput(BaseModel):
    success: bool
    bytes_written: int
    resource_uri: str


class QueryInput(BaseModel):
    sql: str = Field(description="SQL query to execute via MCP postgres server")
    parameters: list[Any] = Field(default_factory=list)


class QueryOutput(BaseModel):
    rows: list[dict[str, Any]]
    row_count: int
    columns: list[str] = Field(default_factory=list)


class ShellInput(BaseModel):
    command: str = Field(description="Shell command to execute (package installs, mkdir, etc.)")
    rationale: str = Field(description="Why this command is necessary for the task")


class ShellOutput(BaseModel):
    command: str
    stdout: str
    stderr: str
    return_code: int
    success: bool


# ---------------------------------------------------------------------------
# PPVE loop schemas
# ---------------------------------------------------------------------------

class PreflightResult(BaseModel):
    """Returned by perform_action() before any Write execution.

    perform_action() inspects real system state — permissions, disk space,
    file size, path sensitivity — and returns a confidence_score in [0.0, 1.0].
    Writes scoring below CONFIDENCE_THRESHOLD are blocked pending human approval.
    """

    confidence_score: float = Field(
        ge=0.0,
        le=1.0,
        description="0.0 = blocked. 1.0 = safe to proceed.",
    )
    assessed_outcome: str = Field(description="What will happen if the write executes")
    risks: list[str] = Field(default_factory=list)
    mitigations: list[str] = Field(default_factory=list)
    requires_clarification: bool = False
    clarification_question: Optional[str] = None


class VerificationResult(BaseModel):
    """Hard structural checks run after perform_action() passes."""

    approved: bool
    checks_passed: list[str] = Field(default_factory=list)
    checks_failed: list[str] = Field(default_factory=list)
    notes: str = ""


# ---------------------------------------------------------------------------
# Persistent state
# ---------------------------------------------------------------------------

class Step(BaseModel):
    """One atomic step in the PPVE loop, written to agent_state.json."""

    step_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    phase: LoopPhase
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    action_type: Optional[ActionType] = None
    action_input: Optional[dict[str, Any]] = None
    preflight: Optional[PreflightResult] = None
    verification: Optional[VerificationResult] = None
    outcome: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    notes: str = ""


class AgentState(BaseModel):
    """Full agent session. Persisted to agent_state.json for crash recovery."""

    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    task: str
    steps: list[Step] = Field(default_factory=list)
    current_phase: LoopPhase = LoopPhase.PLAN
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed: bool = False
    final_result: Optional[str] = None


# ---------------------------------------------------------------------------
# Phase 2 — Domain Context Engine schemas
# ---------------------------------------------------------------------------

class TaskIntent(str, Enum):
    RESEARCH = "research"
    CODE     = "code"
    SYSADMIN = "sysadmin"
    DATA     = "data"
    CREATIVE = "creative"
    GENERAL  = "general"


class EnvScope(str, Enum):
    LOCAL_FILES  = "local_files"
    EXTERNAL_WEB = "external_web"
    DATABASE     = "database"
    MIXED        = "mixed"


class ContextShard(BaseModel):
    source: str       # filename (relative)
    content: str      # first 200 chars extracted
    shard_type: str   # "readme", "schema", "package", "requirements", "cad", "unknown"


class TaskContext(BaseModel):
    intent: TaskIntent
    env_scope: EnvScope
    context_shards: list[ContextShard] = Field(default_factory=list)
    dynamic_prompt: str = ""
    memory_namespace: str = ""   # auto-derived from intent if empty

    @model_validator(mode="after")
    def _derive_namespace(self) -> "TaskContext":
        if not self.memory_namespace:
            self.memory_namespace = self.intent.value
        return self


# ---------------------------------------------------------------------------
# Phase 2 — Epistemic Forager schemas
# ---------------------------------------------------------------------------

class SearchResult(BaseModel):
    title: str
    url: str
    content: str       # Tavily returns pre-parsed text — no HTML scraping needed
    relevance_score: float


class SearchInput(BaseModel):
    query: str
    max_results: int = Field(default=5, ge=1, le=10)
    rationale: str = Field(
        description="Why this search is needed BEFORE planning. "
                    "Required — forces epistemic metacognition."
    )


class SearchOutput(BaseModel):
    query: str
    results: list[SearchResult]
    total_found: int


# ---------------------------------------------------------------------------
# Phase 2 — Trace Memory schemas
# ---------------------------------------------------------------------------

class RecallInput(BaseModel):
    query: str = Field(description="Semantic description of the problem to find precedents for")
    top_k: int = Field(default=3, ge=1, le=10)
    rationale: str = Field(description="Why you are recalling — logged to agent_state.json")


class PastTrace(BaseModel):
    task: str
    trace: str          # compressed reasoning path — the core learning artifact
    outcome: str
    similarity: float
    created_at: datetime


class RecallOutput(BaseModel):
    memories: list[PastTrace]
    namespace: str

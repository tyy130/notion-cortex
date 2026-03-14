# reasoning_agent/orchestrator.py
"""
Domain Context Engine — classifies task intent and scans the working directory.

Runs synchronously before asyncio.run() in main(). Two jobs:
  1. _classify_intent(task)  → TaskIntent  (keyword heuristics)
  2. _scan_shards(cwd)       → list[ContextShard]  (file signature detection)

Combined in build_context(task, cwd) → TaskContext with dynamic_prompt prepopulated.
No API calls, no async I/O — safe to call before the event loop starts.
"""
from __future__ import annotations

import sys
from pathlib import Path

from .schemas import ContextShard, EnvScope, TaskContext, TaskIntent

# ---------------------------------------------------------------------------
# Intent classification
# ---------------------------------------------------------------------------

_INTENT_KEYWORDS: dict[TaskIntent, list[str]] = {
    TaskIntent.RESEARCH: [
        "research", "analyze", "market", "compare",
        "investigate", "survey", "report", "what is", "trend",
    ],
    TaskIntent.CODE: [
        "implement", "fix", "bug", "refactor", "function",
        "test", "build", "compile", "class", "module",
    ],
    TaskIntent.SYSADMIN: [
        "install", "configure", "server", "docker",
        "systemd", "cron", "migrate", "backup", "deploy",
    ],
    TaskIntent.DATA: [
        "database", "sql", "schema", "query", "csv",
        "dataset", "pipeline", "etl", "table", "column",
    ],
    TaskIntent.CREATIVE: [
        "write", "draft", "compose", "story",
        "blog", "email", "proposal", "essay",
    ],
}


def _classify_intent(task: str) -> TaskIntent:
    task_lower = task.lower()
    scores = {
        intent: sum(1 for kw in kws if kw in task_lower)
        for intent, kws in _INTENT_KEYWORDS.items()
    }
    best_intent = max(scores, key=scores.get)
    return best_intent if scores[best_intent] > 0 else TaskIntent.GENERAL


# ---------------------------------------------------------------------------
# Context shard scanning
# ---------------------------------------------------------------------------

_NAMED_FILES: list[tuple[str, str]] = [
    ("README.md",         "readme"),
    ("README.rst",        "readme"),
    ("CLAUDE.md",         "readme"),
    ("package.json",      "package"),
    ("requirements.txt",  "requirements"),
    ("pyproject.toml",    "requirements"),
]

_SCHEMA_GLOBS = ["schema.sql", "*.schema.sql"]
_CAD_GLOBS    = ["*.stl", "*.obj", "*.gcode"]
_SHARD_MAX    = 5
_CONTENT_MAX  = 200


def _scan_shards(cwd: Path, max_shards: int = _SHARD_MAX) -> list[ContextShard]:
    shards: list[ContextShard] = []

    # Named files — checked in priority order
    for filename, shard_type in _NAMED_FILES:
        if len(shards) >= max_shards:
            break
        p = cwd / filename
        if p.is_file():
            shards.append(ContextShard(
                source=filename,
                content=p.read_text(encoding="utf-8", errors="replace")[:_CONTENT_MAX],
                shard_type=shard_type,
            ))

    # Schema files
    for pattern in _SCHEMA_GLOBS:
        if len(shards) >= max_shards:
            break
        for p in list(cwd.glob(pattern))[:1]:
            shards.append(ContextShard(
                source=p.name,
                content=p.read_text(encoding="utf-8", errors="replace")[:_CONTENT_MAX],
                shard_type="schema",
            ))

    # CAD/manufacturing files — just note filenames, don't read binary
    if len(shards) < max_shards:
        cad_files = [f for pat in _CAD_GLOBS for f in cwd.glob(pat)]
        if cad_files:
            names = ", ".join(f.name for f in cad_files[:3])
            extra = f" (+{len(cad_files) - 3} more)" if len(cad_files) > 3 else ""
            shards.append(ContextShard(
                source=names + extra,
                content=f"{len(cad_files)} CAD/manufacturing file(s) detected.",
                shard_type="cad",
            ))

    return shards


# ---------------------------------------------------------------------------
# EnvScope detection
# ---------------------------------------------------------------------------

def _detect_env_scope(intent: TaskIntent, shards: list[ContextShard]) -> EnvScope:
    shard_types = {s.shard_type for s in shards}
    has_schema = "schema" in shard_types
    has_local  = len(shards) > 0

    if has_schema:
        return EnvScope.DATABASE if intent == TaskIntent.DATA else EnvScope.MIXED
    if not has_local and intent == TaskIntent.RESEARCH:
        return EnvScope.EXTERNAL_WEB
    if has_local and intent in (TaskIntent.RESEARCH, TaskIntent.DATA):
        return EnvScope.MIXED
    return EnvScope.LOCAL_FILES if has_local else EnvScope.EXTERNAL_WEB


# ---------------------------------------------------------------------------
# Dynamic prompt generation
# ---------------------------------------------------------------------------

_TOOL_PRIORITY: dict[TaskIntent, str] = {
    TaskIntent.RESEARCH:  "→ tool_search is your PRIMARY tool. Call it before planning.",
    TaskIntent.CODE:      "→ Verify that code compiles/tests pass before calling tool_write.",
    TaskIntent.SYSADMIN:  "→ Treat every shell command as potentially destructive. State your plan before executing.",
    TaskIntent.DATA:      "→ Call tool_recall first; prior DB work is likely in memory. Confirm schema before mutating.",
    TaskIntent.CREATIVE:  "→ Produce a draft first; write the final version only after reviewing it.",
    TaskIntent.GENERAL:   "",
}


def _build_dynamic_prompt(
    intent: TaskIntent, env_scope: EnvScope, shards: list[ContextShard]
) -> str:
    lines = [
        "DOMAIN CONTEXT (auto-detected):",
        f"Intent: {intent.value.upper()} | Scope: {env_scope.value}",
        "",
    ]
    priority = _TOOL_PRIORITY.get(intent, "")
    if priority:
        lines += [priority, ""]

    if shards:
        lines.append("ENVIRONMENTAL CONTEXT:")
        for shard in shards:
            lines += [f"--- {shard.source} ---", shard.content, ""]

    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_context(task: str, cwd: Path | None = None) -> TaskContext:
    """
    Classify task intent, scan cwd for context shards, build dynamic prompt.

    Pure sync — only local file reads. Safe to call before asyncio.run().
    """
    if cwd is None:
        cwd = Path.cwd()

    intent     = _classify_intent(task)
    shards     = _scan_shards(cwd)
    env_scope  = _detect_env_scope(intent, shards)
    prompt     = _build_dynamic_prompt(intent, env_scope, shards)

    print(
        f"[Orchestrator] Intent: {intent.value.upper()} | Scope: {env_scope.value}",
        file=sys.stderr,
    )

    return TaskContext(
        intent=intent,
        env_scope=env_scope,
        context_shards=shards,
        dynamic_prompt=prompt,
    )

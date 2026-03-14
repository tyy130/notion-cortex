# Phase 2: General AGI — Epistemic Foraging, Trace Memory & Domain Context Engine

**Date:** 2026-03-13
**Status:** Revised — Venture Registry replaced by Domain Context Engine
**Repo:** `~/Dev/agi/`
**Depends on:** Phase 1 (PPVE Inner Loop + Dual-Loop Outer Loop) — fully operational

---

## 1. Problem Statement

The Phase 1 agent is a capable Local Operator: it reasons, self-heals, and persists state. But it is epistemically closed — it cannot acquire knowledge it wasn't trained on, it has no memory of past sessions, and it is blind to the domain it is operating in.

Phase 2 upgrades it along three axes:

| Axis | Gap today | Capability after Phase 2 |
|---|---|---|
| Knowledge | Hallucinates or fails on unknown topics | Forages live web before planning |
| Memory | Stateless across sessions | Vectorized trace recall (domain-partitioned) |
| Context | Generic agent blind to task domain | Classifies intent + scans environment; adapts system prompt dynamically |

---

## 2. Architecture Overview

Three new capability layers wrap the existing PPVE loop without modifying it:

```
┌─────────────────────────────────────────────────────────┐
│       DOMAIN CONTEXT ENGINE (sync, before asyncio.run)  │
│  Classify intent → scan cwd → load context shards       │
│  → build TaskContext → prepend dynamic prompt section   │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│               INNER LOOP (PPVE) — unchanged              │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────────────┐ │
│  │ tool_search │ │ tool_recall │ │  existing tools   │ │
│  │  (Tavily)   │ │ (pgvector)  │ │ read/write/shell  │ │
│  └─────────────┘ └─────────────┘ └───────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│         OUTER LOOP (Reflective Healer) — unchanged       │
│  recovery_agent → remediate → resume                     │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│    MEMORY COMMIT (async, scheduled in run())             │
│  asyncio.create_task(store_trace(...)) after             │
│  sm.mark_complete() — does not block user                │
└─────────────────────────────────────────────────────────┘
```

**New files:**
- `reasoning_agent/forager.py` — Tavily search client + `tool_search`
- `reasoning_agent/memory.py` — pgvector client + `tool_recall` + `store_trace`
- `reasoning_agent/orchestrator.py` — task classification + environment scanning + context shard loading

**Modified files:**
- `reasoning_agent/schemas.py` — add `TaskIntent`, `EnvScope`, `ContextShard`, `TaskContext`, `SearchInput`, `SearchOutput`, `SearchResult`, `RecallInput`, `RecallOutput`, `PastTrace`; add `ActionType.SEARCH` and `ActionType.RECALL`
- `reasoning_agent/deps.py` — add `task_context: TaskContext | None = None`; `memory_namespace` becomes a derived `__post_init__` field
- `reasoning_agent/agent.py` — register `tool_search`, `tool_recall`; extend static `SYSTEM_PROMPT` with Foraging and Memory sections; add `@_agent.system_prompt` decorated function to inject `task_context.dynamic_prompt` per-run (see Section 3.4)
- `reasoning_agent/main.py` — argparse CLI (keeps `--resume`, no `--venture`); call orchestrator synchronously before `asyncio.run()`; schedule `store_trace` with `asyncio.shield + wait_for(10s)` in `run()`
- `requirements.txt` — add `tavily-python`, `asyncpg`, `openai` (explicit pin for embeddings API)

**Zero changes to:** `preflight.py`, `recovery.py`, `state.py`, `tools.py`

---

## 3. Domain Context Engine (`orchestrator.py`)

The orchestrator runs **synchronously in `main()` before `asyncio.run()`**. It has two jobs:

1. **Task Intent Classification** — what kind of task is this?
2. **Universal Context Loading** — what does the working directory tell us?

Its output is a `TaskContext` that is forwarded into `AgentDeps`, which the agent uses to adapt its system prompt and set the memory namespace.

### 3.1 Task Intent Classification

The orchestrator performs keyword-based classification of the task string. This is intentionally lightweight — deterministic, instant, free. It can be upgraded to an LLM zero-shot call if more accuracy is needed, but heuristics cover the practical cases.

```python
class TaskIntent(str, Enum):
    RESEARCH  = "research"   # market data, analysis, comparison, surveys
    CODE      = "code"       # implement, fix, debug, refactor, test, build
    SYSADMIN  = "sysadmin"   # install, configure, deploy, server, migration
    DATA      = "data"       # SQL, schema, database, ETL, dataset, pipeline
    CREATIVE  = "creative"   # write, draft, compose, proposal, blog, email
    GENERAL   = "general"    # catch-all, no strong signal

class EnvScope(str, Enum):
    LOCAL_FILES   = "local_files"    # files detected in cwd
    EXTERNAL_WEB  = "external_web"   # RESEARCH intent + no local context
    DATABASE      = "database"       # .sql, schema files, or DATABASE_URL set
    MIXED         = "mixed"          # multiple signals present
```

**Classification algorithm** in `orchestrator.py`:

```python
_INTENT_KEYWORDS: dict[TaskIntent, list[str]] = {
    TaskIntent.RESEARCH:  ["research", "analyze", "market", "compare",
                           "investigate", "survey", "report", "what is", "trend"],
    TaskIntent.CODE:      ["implement", "fix", "bug", "refactor", "function",
                           "test", "build", "compile", "class", "module"],
    TaskIntent.SYSADMIN:  ["install", "configure", "server", "docker",
                           "systemd", "cron", "migrate", "backup", "deploy"],
    TaskIntent.DATA:      ["database", "sql", "schema", "query", "csv",
                           "dataset", "pipeline", "etl", "table", "column"],
    TaskIntent.CREATIVE:  ["write", "draft", "compose", "story",
                           "blog", "email", "proposal", "essay"],
}

def _classify_intent(task: str) -> TaskIntent:
    task_lower = task.lower()
    scores = {intent: sum(1 for kw in kws if kw in task_lower)
              for intent, kws in _INTENT_KEYWORDS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else TaskIntent.GENERAL
```

### 3.2 Universal Context Loader (Context Shards)

The orchestrator scans the current working directory for files that reveal the project's nature. No YAML config required — the environment is the config.

```python
class ContextShard(BaseModel):
    source: str      # filename (relative)
    content: str     # first 200 chars extracted
    shard_type: str  # "readme", "schema", "package", "requirements", "unknown"
```

**File signatures scanned** (in order of priority):

| Pattern | `shard_type` | What it reveals |
|---|---|---|
| `README.md`, `README.rst` | `readme` | Project purpose, language, conventions |
| `*.schema.sql`, `schema.sql`, `migrations/*.sql` | `schema` | DB structure → DATA scope |
| `package.json` | `package` | Node.js project, dependencies |
| `requirements.txt`, `pyproject.toml` | `requirements` | Python project, dependencies |
| `CLAUDE.md` | `readme` | Existing agent instructions |
| `*.stl`, `*.obj`, `*.gcode` | `cad` | CAD/manufacturing context |
| `*.yaml`, `*.yml` (non-system) | `config` | Configuration-heavy project |

Up to **5 shards** are loaded per run to stay within system prompt limits.

**EnvScope detection** follows intent + file presence:

```python
def _detect_env_scope(intent: TaskIntent, shards: list[ContextShard]) -> EnvScope:
    shard_types = {s.shard_type for s in shards}
    has_schema = "schema" in shard_types
    has_local = len(shards) > 0

    if has_schema:
        return EnvScope.DATABASE if intent == TaskIntent.DATA else EnvScope.MIXED
    if not has_local and intent == TaskIntent.RESEARCH:
        return EnvScope.EXTERNAL_WEB
    if has_local and intent in (TaskIntent.RESEARCH, TaskIntent.DATA):
        return EnvScope.MIXED
    return EnvScope.LOCAL_FILES if has_local else EnvScope.EXTERNAL_WEB
```

### 3.3 `TaskContext` Model

```python
class TaskContext(BaseModel):
    intent: TaskIntent
    env_scope: EnvScope
    context_shards: list[ContextShard] = Field(default_factory=list)
    dynamic_prompt: str = ""        # generated section, prepended to system prompt
    memory_namespace: str = ""      # derived from intent if not set

    @model_validator(mode="after")
    def _derive_namespace(self) -> "TaskContext":
        if not self.memory_namespace:
            self.memory_namespace = self.intent.value   # e.g., "code", "research"
        return self
```

### 3.4 Dynamic System Prompt Generation

The `dynamic_prompt` is injected per-run using PydanticAI's `@agent.system_prompt` decorator. The agent singleton (`_agent`) is constructed once with the static `SYSTEM_PROMPT`; the decorator adds a **second system prompt block** that PydanticAI appends on each run, pulling from `ctx.deps.task_context`. This avoids refactoring the singleton while still getting per-invocation context.

```python
# In agent.py, after _agent is constructed:

@_agent.system_prompt
async def _inject_context(ctx: RunContext[AgentDeps]) -> str:
    if ctx.deps.task_context and ctx.deps.task_context.dynamic_prompt:
        return ctx.deps.task_context.dynamic_prompt
    return ""
```

PydanticAI concatenates all system prompt blocks (static + dynamic) before the first model call. The order is: static `SYSTEM_PROMPT` first, then `_inject_context` output.

The `dynamic_prompt` content tells the agent what context it is operating in and which tools to prioritize.

**Intent → tool priority mapping:**

| Intent | System prompt effect |
|---|---|
| RESEARCH | "tool_search is your PRIMARY tool. Call it before planning." |
| CODE | "Verify that code compiles/tests pass before calling tool_write." |
| SYSADMIN | "Treat every shell command as potentially destructive. State your plan before executing." |
| DATA | "Call tool_recall first; prior DB work is likely in memory. Confirm schema before mutating." |
| CREATIVE | "Produce a draft first; write the final version only after reviewing it." |
| GENERAL | No tool priority override — default PPVE behavior. |

**Format of generated `dynamic_prompt`:**

```
DOMAIN CONTEXT (auto-detected):
Intent: {intent.value.upper()} | Scope: {env_scope.value}

{tool_priority_line}

ENVIRONMENTAL CONTEXT:
{for each shard: "--- {source} ---\n{content}\n"}
```

The orchestrator function signature:

```python
def build_context(task: str, cwd: Path | None = None) -> TaskContext:
    """
    Classify task intent, scan cwd for context shards, build dynamic prompt.
    Pure sync — no I/O beyond local file reads. Safe to call before asyncio.run().
    """
```

---

## 4. Epistemic Forager (`forager.py`)

### 4.1 Tool Interface

New entries in `schemas.py`:

```python
class ActionType(str, Enum):
    READ   = "read"
    WRITE  = "write"
    QUERY  = "query"
    SHELL  = "shell"
    SEARCH = "search"   # NEW
    RECALL = "recall"   # NEW

class SearchInput(BaseModel):
    query: str
    max_results: int = Field(default=5, ge=1, le=10)
    rationale: str    # required — forces epistemic metacognition

class SearchResult(BaseModel):
    title: str
    url: str
    content: str      # Tavily returns pre-parsed text — no HTML scraping
    relevance_score: float

class SearchOutput(BaseModel):
    query: str
    results: list[SearchResult]
    total_found: int
```

### 4.2 Implementation Notes

- Tavily client initialized lazily inside `forager.py` (same SOCKS-proxy-safe singleton pattern as `get_agent()`)
- `TAVILY_API_KEY` validated at startup in `main.py`; if missing, print a warning but do not crash — agent runs without search capability and system prompt notes the limitation
- Results logged as `ActionType.SEARCH` / `LoopPhase.EXECUTE` steps in `agent_state.json`
- `tool_search` bypasses the PPVE write gate — same pattern as `tool_read`
- Agent discards results with `relevance_score < 0.3` before incorporating into plan

**Error handling in `tool_search`:**
- Tavily 401 (bad key) → catch, return `SearchOutput(results=[], total_found=0)` with logged error note; do not propagate to outer loop
- Tavily 5xx / timeout → catch, same empty result return with error note
- Empty result set (all scores < 0.3) → return results as-is; system prompt instructs agent to report "not yet publicly available" rather than speculate

### 4.3 System Prompt Addition

```
EPISTEMIC FORAGING PROTOCOL:
Before planning any task involving:
  - Market data, trends, or current events
  - Libraries, APIs, or tools you are uncertain about
  - Domain-specific knowledge not present in local files
  - Any factual claim you are not confident about

→ Call tool_search() FIRST with a specific rationale.
→ Build your plan from what you find, not from memory alone.
→ If all relevance_scores are below 0.3, or the result set is empty,
  report that the information is not yet publicly available.
  Do NOT speculate. Do NOT hallucinate.
```

---

## 5. Trace Memory (`memory.py`)

### 5.1 Neon PostgreSQL Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS trace_memory (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace   TEXT NOT NULL,
    task        TEXT NOT NULL,
    trace       TEXT NOT NULL,       -- compressed reasoning path
    outcome     TEXT NOT NULL,       -- final_result from AgentState
    embedding   VECTOR(1536) NOT NULL,  -- text-embedding-3-small (1536 dims)
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- hnsw index: handles empty tables gracefully, no cold-start issue
-- ivfflat is not used: requires >= lists*3 rows before queries are reliable
CREATE INDEX IF NOT EXISTS trace_memory_embedding_idx
    ON trace_memory
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

**Embedding model coupling:** `VECTOR(1536)` is coupled to `text-embedding-3-small`. If the model is changed to `text-embedding-3-large` (3072 dims), the column and index must be recreated. This is an intentional constraint. Do not change the embedding model without a schema migration.

**Memory namespace:** Derived from `task_context.intent.value` (e.g., `"code"`, `"research"`, `"data"`). A task classified as GENERAL uses `"general"`. This partitions traces by functional domain, enabling the agent to recall "how I debugged a Python import error" when next given a code task.

### 5.2 `store_trace` (write path)

**Scheduled in `main.py`'s async `run()` function, not inside `state.py`:**

```python
# in run(), after sm.mark_complete(result.output):
sm.mark_complete(result.output)
trace_task = asyncio.create_task(
    store_trace(
        namespace=deps.memory_namespace,
        task=task,
        steps=sm.state.steps,
        outcome=result.output,
    )
)
try:
    await asyncio.wait_for(asyncio.shield(trace_task), timeout=10.0)
except asyncio.TimeoutError:
    print("[Memory] store_trace timed out — trace not persisted.", file=sys.stderr)
return result.output
```

`state.py` remains unchanged. `store_trace` is a coroutine defined in `memory.py`.

Steps inside `store_trace`:
1. Compress the session's `steps` list into a structured summary (phases, tool call names, key decisions, errors encountered)
2. Concatenate `task + "\n" + trace + "\n" + outcome` as the embedding input
3. Call `openai.AsyncOpenAI().embeddings.create(model="text-embedding-3-small", input=...)` → 1536-dim vector
4. Assert `len(embedding_vector) == 1536` — guards against accidental model string changes that would produce a dimension mismatch in pgvector
5. `INSERT INTO trace_memory (namespace, task, trace, outcome, embedding)` via `asyncpg` (truly async — never blocks the event loop). Connection opened per call — no pool needed for a background fire-and-forget

### 5.3 `tool_recall` (read path)

New entries in `schemas.py`:

```python
class RecallInput(BaseModel):
    query: str
    top_k: int = Field(default=3, ge=1, le=10)
    rationale: str    # required, logged

class PastTrace(BaseModel):
    task: str
    trace: str         # the compressed reasoning path — core learning artifact
    outcome: str
    similarity: float
    created_at: datetime

class RecallOutput(BaseModel):
    memories: list[PastTrace]
    namespace: str
```

SQL executed by `tool_recall`:

```sql
SELECT task, trace, outcome, created_at,
       1 - (embedding <=> $1::vector) AS similarity
FROM trace_memory
WHERE namespace = $2
ORDER BY embedding <=> $1::vector
LIMIT $3;
```

Returns an empty list gracefully on a fresh database — no error.

### 5.4 System Prompt Addition

```
MEMORY RECALL PROTOCOL:
Before solving any problem involving infrastructure, deployment,
database operations, API integrations, or error recovery —
call tool_recall() first.

If a similar problem was solved before, build on that solution.
The 'trace' field shows the reasoning path that was used —
read it carefully and adapt it to the current problem.
Do NOT re-derive what has already been learned.
```

---

## 6. Updated `AgentDeps`

```python
from dataclasses import dataclass, field

@dataclass
class AgentDeps:
    state_manager: StateManager
    task_context: TaskContext | None = None    # None = unclassified general mode
    memory_namespace: str = field(init=False)  # always derived — never set by caller

    def __post_init__(self) -> None:
        self.memory_namespace = (
            self.task_context.memory_namespace
            if self.task_context is not None
            else "general"
        )
```

`memory_namespace` is a derived field (`field(init=False)`) — callers only set `task_context`. This eliminates the silent footgun of the two fields diverging.

---

## 7. CLI Interface

`main.py` switches from naive `sys.argv` parsing to `argparse`. The `--venture` flag is removed — context is auto-detected:

```python
parser = argparse.ArgumentParser(prog="reasoning_agent")
parser.add_argument("task", nargs="*", help="Task description")
parser.add_argument("--resume", action="store_true", help="Resume previous session")
args = parser.parse_args()
```

Usage examples:

```bash
# General mode — orchestrator classifies intent from the task
python -m reasoning_agent "Summarize all Python files"
# → [Orchestrator] Intent: CODE | Scope: LOCAL_FILES

# Research task — orchestrator elevates tool_search
python -m reasoning_agent "What is the 2026 market size for AI coding assistants?"
# → [Orchestrator] Intent: RESEARCH | Scope: EXTERNAL_WEB

# CAD context auto-detected from cwd containing .stl files
python -m reasoning_agent "Check for manifold errors in the bracket design"
# → [Orchestrator] Intent: CODE | Scope: LOCAL_FILES
# → [Context] bracket_v3.stl, README.md loaded as shards

# Resume previous session
python -m reasoning_agent --resume "Continue the previous task"
```

The `run()` signature gains a `task_context` parameter forwarded into `AgentDeps`:

```python
async def run(
    task: str,
    resume: bool = False,
    task_context: TaskContext | None = None,
) -> str:
    ...
    deps = AgentDeps(
        state_manager=sm,
        task_context=task_context,
        # memory_namespace is derived automatically in AgentDeps.__post_init__
    )
    ...
    # After sm.mark_complete(result.output):
    trace_task = asyncio.create_task(store_trace(...))
    try:
        await asyncio.wait_for(asyncio.shield(trace_task), timeout=10.0)
    except asyncio.TimeoutError:
        print("[Memory] store_trace timed out — trace not persisted.", file=sys.stderr)
    return result.output


def main() -> None:
    args = parse_args()
    task = " ".join(args.task) or DEFAULT_TASK

    # Sync — safe; no event loop running yet
    task_context = build_context(task, cwd=Path.cwd())

    result = asyncio.run(run(task, resume=args.resume, task_context=task_context))
    ...
```

**`asyncio.shield` + `wait_for` pattern:** `asyncio.run()` cancels all pending tasks when `run()` returns. A bare `create_task` would be garbage-collected before `store_trace` completes. The `shield` prevents cancellation; the 10-second timeout ensures `main()` doesn't hang if the DB is unreachable.

---

## 8. Data Flow — Test Task

> *"Fix the manifold error in bracket_v3.stl."* (cwd contains `bracket_v3.stl`, `README.md`)

1. **Orchestrator (sync):** task → intent=`CODE`, cwd scan finds `.stl` and `README.md` → shards loaded → `dynamic_prompt` built with "Verify before writing" emphasis → `memory_namespace = "code"`
2. **Memory:** `tool_recall("manifold error STL fix", rationale="Check for prior trace")` → first run returns empty; future runs recall the fix pattern
3. **Forager:** `tool_search("PLA+ manifold error tolerance fix", rationale="Domain not in training data")` → Tavily returns 3 results about valid manifold geometry
4. **Read:** `tool_read("bracket_v3.stl")` → inspect geometry
5. **Synthesize:** agent identifies face normals issue from Tavily results + trace recall
6. **Write:** `tool_write("bracket_v3_fixed.stl")` → PPVE gate fires → preflight + verify → execute
7. **Memory commit:** `store_trace(namespace="code", task=task, steps=sm.state.steps, outcome=result.output)` scheduled via `asyncio.create_task` → background write to pgvector

Next time a `.stl` fix task is run, `tool_recall` returns the trace from step 7 with the reasoning path, including the manifold fix approach.

---

## 9. Environment Variables Required

```bash
OPENAI_API_KEY=...          # existing — also used for embeddings (text-embedding-3-small)
DATABASE_URL=...             # existing Neon connection — also used for trace_memory table
TAVILY_API_KEY=...           # new — obtain from app.tavily.com
```

New additions to `requirements.txt`: `tavily-python`, `asyncpg`, `openai` (explicit pin).
`rapidfuzz` and `PyYAML` are NOT required — venture YAML loading is removed.

---

## 10. Failure Modes & Mitigations

| Failure | Behavior |
|---|---|
| `TAVILY_API_KEY` missing | Warning at startup; `tool_search` returns empty results with error note; agent continues without foraging |
| Tavily 5xx / timeout | `tool_search` catches exception, returns empty `SearchOutput`, logs error to state |
| No files in cwd (empty project) | Orchestrator returns `TaskContext` with empty `context_shards`; dynamic prompt contains intent only; agent operates normally |
| Unclassifiable task (all keyword scores = 0) | Intent defaults to `GENERAL`; no tool priority override; standard PPVE behavior |
| `DATABASE_URL` missing or empty | `tool_recall` catches connection error (`asyncpg.InvalidCatalogNameError` or `OSError`), returns empty `RecallOutput`, logs warning; `store_trace` silently drops trace |
| `trace_memory` table not yet migrated | `tool_recall` catches `asyncpg.exceptions.UndefinedTableError`, returns empty `RecallOutput`, logs warning |
| `store_trace` times out (network, auth) | `asyncio.wait_for` fires after 10s; main returns with warning; trace lost for this session (acceptable — memory is enhancement, not critical path) |
| Empty `trace_memory` (cold start) | `tool_recall` returns empty list; `hnsw` index handles empty tables without error |

---

## 11. Success Criteria

- [ ] `tool_search` returns Tavily results logged to `agent_state.json` with rationale
- [ ] Orchestrator correctly classifies "fix the bug in auth.py" as CODE intent
- [ ] Orchestrator correctly classifies "research 2026 AI market trends" as RESEARCH intent
- [ ] README.md in cwd is loaded as a context shard and appears in dynamic_prompt
- [ ] RESEARCH intent elevates tool_search in the generated dynamic_prompt section
- [ ] `store_trace` writes to Neon `trace_memory` without blocking agent completion
- [ ] `tool_recall` returns `trace` + `outcome` + similarity, scoped to namespace
- [ ] `tool_recall` on empty DB returns empty list, no error
- [ ] Memory namespace for a CODE task is `"code"`, for RESEARCH is `"research"`
- [ ] RESEARCH intent with no local files produces `EnvScope.EXTERNAL_WEB`
- [ ] DATA intent with a `.schema.sql` file in cwd produces `EnvScope.DATABASE`
- [ ] Test task executes end-to-end: classify → load shards → forage → recall → synthesize → write → store trace
- [ ] Agent in cwd with `.stl` files loads the CAD context shard automatically, no config required

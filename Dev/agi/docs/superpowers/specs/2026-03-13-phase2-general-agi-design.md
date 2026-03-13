# Phase 2: General AGI — Epistemic Foraging, Trace Memory & Venture Orchestration

**Date:** 2026-03-13
**Status:** Reviewed
**Repo:** `~/Dev/agi/`
**Depends on:** Phase 1 (PPVE Inner Loop + Dual-Loop Outer Loop) — fully operational

---

## 1. Problem Statement

The Phase 1 agent is a capable Local Operator: it reasons, self-heals, and persists state. But it is epistemically closed — it cannot acquire knowledge it wasn't trained on, it has no memory of past sessions, and it has no concept of which business venture it is serving.

Phase 2 upgrades it along three axes:

| Axis | Gap today | Capability after Phase 2 |
|---|---|---|
| Knowledge | Hallucinate or fail on unknown topics | Forage live web before planning |
| Memory | Stateless across sessions | Vectorized trace recall (domain-partitioned) |
| Identity | Single generic agent | Venture-aware via YAML registry |

---

## 2. Architecture Overview

Three new capability layers wrap the existing PPVE loop without modifying it:

```
┌─────────────────────────────────────────────────┐
│         ORCHESTRATOR (sync, before asyncio.run)  │
│  Detect venture → load YAML → build AgentDeps   │
│  → prepend context_injection to system prompt   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│               INNER LOOP (PPVE) — unchanged      │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ tool_search │ │ tool_recall │ │ existing  │ │
│  │  (Tavily)   │ │ (pgvector)  │ │  tools    │ │
│  └─────────────┘ └─────────────┘ └───────────┘ │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│         OUTER LOOP (Reflective Healer) — unchanged│
│  recovery_agent → remediate → resume             │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│    MEMORY COMMIT (async, scheduled in run())     │
│  asyncio.create_task(store_trace(...)) after     │
│  sm.mark_complete() — does not block user        │
└─────────────────────────────────────────────────┘
```

**New files:**
- `reasoning_agent/forager.py` — Tavily search client + `tool_search`
- `reasoning_agent/memory.py` — pgvector client + `tool_recall` + `store_trace`
- `reasoning_agent/orchestrator.py` — venture detection + context injection
- `ventures/tacticdev.yaml` — reference venture configuration

**Modified files:**
- `reasoning_agent/schemas.py` — add `SearchInput`, `SearchOutput`, `RecallInput`, `RecallOutput`, `PastTrace`, `VentureConfig`; add `ActionType.SEARCH` and `ActionType.RECALL` to the `ActionType` enum
- `reasoning_agent/deps.py` — add `venture: VentureConfig | None = None`, `memory_namespace: str = "general"`
- `reasoning_agent/agent.py` — register `tool_search`, `tool_recall`; extend system prompt
- `reasoning_agent/main.py` — switch to `argparse` (adds `--venture`, keeps `--resume`); call orchestrator synchronously before `asyncio.run()`; schedule `store_trace` as `asyncio.create_task` inside async `run()` after `sm.mark_complete()`
- `reasoning_agent/tools.py` — add `high_risk_tools` interception at top of `tool_write` (threshold override) and top of `tool_shell` (early `NeedsHumanClarification` raise)
- `requirements.txt` — add `tavily-python`, `rapidfuzz`, `asyncpg` (truly-async Neon writes); `psycopg2-binary` already present; `openai` already installed

**Zero changes to:** `preflight.py`, `recovery.py`, `state.py`

---

## 3. Venture Registry & Orchestrator

### 3.1 Venture YAML Schema

Every venture is a single YAML file in `ventures/`. Adding a new venture requires no code changes.

```yaml
# ventures/tacticdev.yaml
venture_name: "TacticDev"
domain: "AI Agency / Dev Tools"
aliases:
  - "tactic"
  - "tacticdev"
  - "agency"
priority_tools:
  - tavily_search
  - neon_postgres
high_risk_tools:
  - tool_shell      # always requires human approval in this venture context
context_injection: |
  You are operating as the TacticDev AI engine.
  TacticDev builds AI automations and agentic systems for SMBs.
  Prioritize developer-facing solutions. When foraging, prefer
  technical sources (GitHub, docs, arXiv) over news articles.
  Check existing client schemas in the DB before proposing
  new data structures.
memory_namespace: "tacticdev"
```

**Pydantic model** (added to `schemas.py`):
```python
class VentureConfig(BaseModel):
    venture_name: str
    domain: str
    aliases: list[str] = []
    priority_tools: list[str] = []
    high_risk_tools: list[str] = []
    context_injection: str = ""
    memory_namespace: str = ""  # defaults to venture_name.lower() if empty

    @model_validator(mode="after")
    def _set_namespace_default(self) -> "VentureConfig":
        if not self.memory_namespace:
            self.memory_namespace = self.venture_name.lower().replace(" ", "_")
        return self
```

### 3.2 Auto-Detection Logic

**Critical: the orchestrator runs synchronously in `main()` before `asyncio.run()`**, so blocking `input()` for the confirmation prompt is safe — no event loop is running yet.

Flow in `orchestrator.py` → `detect_venture(task: str, venture_dir: Path) -> VentureConfig | None`:

1. **Directory check:** if `ventures/` does not exist, print a warning and return `None` (general mode). Do not raise — absence of ventures is a valid state.
2. **Tokenize** the task string (lowercase, strip punctuation)
3. **Score** each `ventures/*.yaml` against `venture_name + domain + aliases` using `rapidfuzz.fuzz.token_set_ratio`
4. **Route:**
   - Score ≥ 75 → load venture, print `"Venture detected: TacticDev. Loading AI Agency context."`
   - Score 50–74 → print `"Did you mean TacticDev? (y/n)"`, call blocking `input()`, load if confirmed
   - Score < 50 → return `None` (general mode, no message)
5. **`--venture` override:** parse YAML at `ventures/<name>.yaml` directly; raise a clear `FileNotFoundError` with a user-friendly message if the file is missing

### 3.3 `high_risk_tools` Integration with PPVE

Two separate interception points, not a single mechanism:

**`tool_write`** — at the top of the function, before `perform_action()`:
```python
if ctx.deps.venture and "tool_write" in ctx.deps.venture.high_risk_tools:
    raise NeedsHumanClarification(
        f"tool_write is listed as high-risk for venture "
        f"'{ctx.deps.venture.venture_name}'. Explicit approval required."
    )
```
If `"tool_write"` is in `venture.high_risk_tools`, bypass `perform_action()` entirely and route straight to human.

**`tool_shell`** — at the top of the function, before the regex blocklist:
```python
if ctx.deps.venture and "tool_shell" in ctx.deps.venture.high_risk_tools:
    raise NeedsHumanClarification(
        f"tool_shell is listed as high-risk for venture "
        f"'{ctx.deps.venture.venture_name}'. Explicit approval required."
    )
```

Both checks happen before any execution, before pattern matching, before preflight. The effect for both tools is identical: `NeedsHumanClarification` is raised and the human gate in `main.py` handles it.

---

## 4. Epistemic Forager (`forager.py`)

### 4.1 Tool Interface

New entries in `schemas.py`:

```python
class ActionType(str, Enum):
    READ = "read"
    WRITE = "write"
    QUERY = "query"
    SHELL = "shell"
    SEARCH = "search"   # NEW
    RECALL = "recall"   # NEW

class SearchInput(BaseModel):
    query: str
    max_results: int = Field(default=5, le=10)
    rationale: str    # required, logged to agent_state.json

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
- `TAVILY_API_KEY` validated at startup in `main.py` proxy-clearing block; if missing, print a warning but do not crash — agent runs without search capability and system prompt notes the limitation
- Results logged as `ActionType.SEARCH` / `LoopPhase.EXECUTE` steps in `agent_state.json`
- `tool_search` bypasses the PPVE write gate (reads are unrestricted) — same pattern as `tool_read`
- Agent discards results with `relevance_score < 0.3` before incorporating into plan

**Error handling in `tool_search`:**
- Tavily 401 (bad key) → catch, return `SearchOutput(results=[], total_found=0)` with a logged error note; do not propagate to outer loop (a missing search key is not a fixable environment error)
- Tavily 5xx / timeout → catch, same empty result return with error note
- Empty result set (all scores < 0.3) → return results as-is; the system prompt instructs the agent to report "not yet publicly available" rather than speculate

### 4.3 System Prompt Addition

```
EPISTEMIC FORAGING PROTOCOL:
Before planning any task involving:
  - Market data, trends, or current events
  - Libraries, APIs, or tools you are uncertain about
  - Venture-specific domain knowledge not present in local files
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
-- ivfflat is not used: it requires >= lists*3 rows before queries are reliable
CREATE INDEX IF NOT EXISTS trace_memory_embedding_idx
    ON trace_memory
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

**Embedding model coupling:** `VECTOR(1536)` is coupled to `text-embedding-3-small`. If the model is changed to `text-embedding-3-large` (3072 dims), the column and index must be recreated. This is an intentional constraint documented here. Do not change the embedding model without a schema migration.

### 5.2 `store_trace` (write path)

**Scheduled in `main.py`'s async `run()` function, not inside `state.py`:**

```python
# in run(), after sm.mark_complete(result.output):
sm.mark_complete(result.output)
asyncio.create_task(
    store_trace(
        namespace=deps.memory_namespace,
        task=task,
        steps=sm.state.steps,
        outcome=result.output,
    )
)
return result.output
```

`state.py` remains unchanged. `store_trace` is a coroutine defined in `memory.py`.

Steps inside `store_trace`:
1. Compress the session's `steps` list into a structured summary (phases, tool call names, key decisions, errors encountered)
2. Concatenate `task + "\n" + trace + "\n" + outcome` as the embedding input
3. Call `openai.AsyncOpenAI().embeddings.create(model="text-embedding-3-small", input=...)` → 1536-dim vector
4. Assert `len(embedding_vector) == 1536` before inserting — guards against accidental model string changes that would produce a dimension mismatch in pgvector
5. `INSERT INTO trace_memory (namespace, task, trace, outcome, embedding)` using `asyncpg` (truly async — never blocks the event loop). Connection opened with `asyncpg.connect(DATABASE_URL)` per call (connection pool is overkill for a background task)

### 5.3 `tool_recall` (read path)

New entries in `schemas.py`:

```python
class RecallInput(BaseModel):
    query: str
    top_k: int = 3
    rationale: str    # required, logged

class PastTrace(BaseModel):
    task: str
    trace: str         # the compressed reasoning path — this is why the agent recalls
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
@dataclass
class AgentDeps:
    state_manager: StateManager
    venture: VentureConfig | None = None      # None = general mode
    memory_namespace: str = "general"         # derived from venture or default
```

---

## 7. CLI Interface

`main.py` switches from naive `sys.argv` parsing to `argparse`:

```python
parser = argparse.ArgumentParser(prog="reasoning_agent")
parser.add_argument("task", nargs="*", help="Task description")
parser.add_argument("--venture", default=None, help="Venture name to load context for")
parser.add_argument("--resume", action="store_true", help="Resume previous session")
args = parser.parse_args()
```

Usage examples:

```bash
# General mode
python -m reasoning_agent "Summarize all Python files"

# Explicit venture
python -m reasoning_agent --venture tacticdev "Review our MCP architecture"

# Auto-detected venture (orchestrator runs before asyncio.run)
python -m reasoning_agent "What's the TacticDev client pipeline looking like?"
# → "Venture detected: TacticDev. Loading AI Agency context."

# Resume with venture
python -m reasoning_agent --venture tacticdev --resume "Continue the previous task"
```

Orchestrator is called synchronously in `main()` before `asyncio.run(run(...))`. The `run()` signature gains a `venture` parameter which is forwarded into `AgentDeps`:

```python
async def run(
    task: str,
    resume: bool = False,
    venture: VentureConfig | None = None,
) -> str:
    ...
    deps = AgentDeps(
        state_manager=sm,
        venture=venture,
        memory_namespace=venture.memory_namespace if venture else "general",
    )
    ...
    # After sm.mark_complete(result.output):
    task_obj = asyncio.create_task(store_trace(...))
    try:
        await asyncio.wait_for(asyncio.shield(task_obj), timeout=10.0)
    except asyncio.TimeoutError:
        pass  # trace write in progress; log warning and return
    return result.output


def main() -> None:
    args = parse_args()
    task = " ".join(args.task) or DEFAULT_TASK

    # Sync — safe for blocking input() if confirmation needed
    venture = load_venture(task, venture_flag=args.venture)

    result = asyncio.run(run(task, resume=args.resume, venture=venture))
    ...
```

**`asyncio.shield` + `wait_for` pattern (N4 fix):** `asyncio.run()` cancels all pending tasks when `run()` returns. A bare `create_task` would be garbage-collected before `store_trace` completes. The `shield` prevents cancellation; the 10-second timeout ensures the main function doesn't hang if the DB is unreachable. If the timeout fires, the trace is lost for this session (acceptable: memory is enhancement, not critical path).

---

## 8. Data Flow — Test Task

> *"Research the current 2026 market saturation for AI-driven debt relief tools in California. Compare with the DebtLogic.ai DB schema. Suggest a competitive feature."*

1. **Orchestrator (sync):** no `ventures/debtlogic.yaml` → general mode; `memory_namespace = "general"`
2. **Forager:** `tool_search("2026 AI debt relief California market saturation", rationale="Market data not in training corpus")` → Tavily returns 5 results with relevance scores; agent discards any < 0.3
3. **Memory:** `tool_recall("debt relief fintech California competitive analysis", rationale="Check for prior research")` → empty on first run → agent proceeds fresh
4. **Read:** `tool_read` on Neon → SELECT schema for DebtLogic tables
5. **Synthesize:** agent compares market findings vs. schema gaps → proposes feature
6. **Write:** `tool_write("output/debtlogic_feature_proposal.md")` → PPVE gate fires → preflight + verify → execute
7. **Memory commit:** `asyncio.create_task(store_trace("general", task, steps, result))` → background write to pgvector

---

## 9. Environment Variables Required

```bash
OPENAI_API_KEY=...          # existing — also used for embeddings (text-embedding-3-small)
DATABASE_URL=...             # existing Neon connection — also used for trace_memory table
TAVILY_API_KEY=...           # new — obtain from app.tavily.com
```

Note: `openai` Python package is already installed as a transitive dependency. `psycopg2-binary` is already installed (used by recovery agent). New additions to `requirements.txt`: `tavily-python`, `rapidfuzz`, `asyncpg`.

---

## 10. Failure Modes & Mitigations

| Failure | Behavior |
|---|---|
| `TAVILY_API_KEY` missing | Warning at startup; `tool_search` returns empty results with error note; agent continues without foraging |
| Tavily 5xx / timeout | `tool_search` catches exception, returns empty `SearchOutput`, logs error to state |
| `ventures/` directory missing | Orchestrator warns to stdout, returns `None`, agent runs in general mode |
| `--venture foo` with no `ventures/foo.yaml` | Clear `FileNotFoundError` with user-friendly message, exits before `asyncio.run()` |
| `trace_memory` table not yet migrated | `tool_recall` catches `asyncpg.exceptions.UndefinedTableError` (or equivalent), returns empty `RecallOutput`, logs warning |
| `store_trace` times out (network, auth) | `asyncio.wait_for` fires after 10s; main returns with warning; trace lost for this session (acceptable — memory is enhancement, not critical path) |
| Empty `trace_memory` (cold start) | `tool_recall` returns empty list; `hnsw` index handles empty tables without error |

---

## 11. Success Criteria

- [ ] `tool_search` returns Tavily results logged to `agent_state.json` with rationale
- [ ] Venture auto-detection correctly routes "TacticDev" queries with score ≥ 75
- [ ] `--venture tacticdev` loads the YAML without fuzzy matching
- [ ] Missing `ventures/` directory prints a warning and falls through to general mode
- [ ] `high_risk_tools` forces `NeedsHumanClarification` for both `tool_write` and `tool_shell` before any execution
- [ ] `store_trace` writes to Neon `trace_memory` without blocking agent completion
- [ ] `tool_recall` returns `trace` + `outcome` + similarity, scoped to namespace
- [ ] `tool_recall` on empty DB returns empty list, no error
- [ ] Test task executes end-to-end: forage → recall → read schema → synthesize → write output → store trace
- [ ] Adding a second venture YAML requires zero code changes

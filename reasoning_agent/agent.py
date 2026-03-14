"""
PydanticAI agent definition — Plan-Preflight-Verify-Execute reasoning agent.

Tools:
  • tool_read   — unrestricted file reads
  • tool_write  — PPVE-gated writes (confidence gate via perform_action)
  • tool_query  — SQL passthrough (activate by wiring an MCP postgres server below)

MCP servers (optional):
  • Postgres MCP — set DATABASE_URL and uncomment _pg_server to activate.
  • Do NOT add a filesystem MCP server: it would bypass the PPVE write gate.
"""
from __future__ import annotations

import os

from pydantic_ai import Agent

from .deps import AgentDeps
from .memory import tool_recall
from .tools import tool_read, tool_write, tool_query, tool_shell

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a Reasoning Agent that operates in a strict Plan → Preflight → Verify → Execute loop.

CORE RULES:
1. PLAN first. State your step-by-step plan before taking any action.
2. Every WRITE call automatically runs perform_action(), which inspects real system state
   (permissions, disk space, path sensitivity, file size) and returns a confidence score.
   If the score is below 0.85, the write is blocked and a clarification question is
   surfaced — do NOT retry until the human responds.
3. Always provide a specific rationale (≥ 5 meaningful words) on every write_resource call.
   Vague rationale lowers the confidence score and triggers the clarification gate.
4. READ and QUERY are unrestricted — they are non-destructive and skip the gate.
5. If a tool returns an error, report it clearly and wait for guidance before retrying.

AVAILABLE TOOLS:
- read_resource(resource_uri, encoding?)                         → read a file
- write_resource(resource_uri, content, mode, rationale)        → PPVE-gated write
- query(sql)                                                     → read-only SQL via MCP postgres
- shell(command, rationale)                                      → run a shell command
- tool_search(query, rationale, max_results?)                    → web search via Tavily
- tool_recall(query, rationale, top_k?)                         → retrieve past reasoning traces

MODE values for write_resource: "overwrite" | "append" | "create"

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

MEMORY RECALL PROTOCOL:
Before solving any problem involving infrastructure, deployment,
database operations, API integrations, or error recovery —
call tool_recall() first.

If a similar problem was solved before, build on that solution.
The 'trace' field shows the reasoning path that was used —
read it carefully and adapt it to the current problem.
Do NOT re-derive what has already been learned.

SELF-HEALING PROTOCOL:
If a tool fails due to a missing package or missing directory, use shell() to fix it
before retrying. Examples:
  - ModuleNotFoundError: psycopg2  → shell(".venv/bin/pip install psycopg2-binary", "install missing db driver")
  - FileNotFoundError: output/     → shell("mkdir -p output", "create missing output directory")
"""

# ---------------------------------------------------------------------------
# MCP server configuration
# ---------------------------------------------------------------------------

from pydantic_ai.mcp import MCPServerStdio

# Postgres MCP — exposes `query` tool to the agent. Requires DATABASE_URL.
# Do NOT add a filesystem MCP here: it would bypass the PPVE write gate.
_DATABASE_URL = os.environ.get("DATABASE_URL", "")

_pg_server: MCPServerStdio | None = (
    MCPServerStdio(
        "npx",
        args=["-y", "@modelcontextprotocol/server-postgres", _DATABASE_URL],
    )
    if _DATABASE_URL
    else None
)

# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------

_agent: Agent[AgentDeps, str] | None = None


def get_agent() -> Agent[AgentDeps, str]:
    """Return the singleton agent, constructing it on first call.

    Deferred so that OPENAI_API_KEY only needs to be set when the agent is
    actually used, not at import time.
    """
    global _agent
    if _agent is None:
        mcp_servers = [_pg_server] if _pg_server else []
        _agent = Agent(
            "openai:gpt-4o",
            system_prompt=SYSTEM_PROMPT,
            deps_type=AgentDeps,
            mcp_servers=mcp_servers,
            output_type=str,
        )
        _agent.tool(tool_read)
        _agent.tool(tool_write)
        _agent.tool(tool_query)
        _agent.tool(tool_shell)

        from pydantic_ai import RunContext
        from .forager import tool_search

        # Register forager tool
        _agent.tool(tool_search)
        _agent.tool(tool_recall)

        # Per-run dynamic prompt injection from Domain Context Engine
        @_agent.system_prompt
        async def _inject_domain_context(ctx: RunContext[AgentDeps]) -> str:
            if ctx.deps.task_context and ctx.deps.task_context.dynamic_prompt:
                return ctx.deps.task_context.dynamic_prompt
            return ""

    return _agent

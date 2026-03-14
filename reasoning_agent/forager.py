# reasoning_agent/forager.py
"""
Epistemic Forager — Tavily web search tool.

tool_search() is registered on the agent and bypasses the PPVE write gate
(same as tool_read — reads are unrestricted).

Tavily client is initialized lazily via _get_tavily() to avoid SOCKS-proxy
crashes at import time. The same singleton pattern as get_agent().
"""
from __future__ import annotations

import os

from pydantic_ai import RunContext

from .deps import AgentDeps
from .schemas import ActionType, LoopPhase, SearchInput, SearchOutput, SearchResult, Step

_tavily_client = None
_RELEVANCE_THRESHOLD = 0.3


def _get_tavily():
    global _tavily_client
    if _tavily_client is None:
        from tavily import TavilyClient
        _tavily_client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])
    return _tavily_client


async def tool_search(ctx: RunContext[AgentDeps], input: SearchInput) -> SearchOutput:
    """Search the web via Tavily. Call BEFORE planning when you lack current knowledge."""
    try:
        client = _get_tavily()
        raw = client.search(
            query=input.query,
            max_results=input.max_results,
        )
        all_results = [
            SearchResult(
                title=r.get("title", ""),
                url=r.get("url", ""),
                content=r.get("content", ""),
                relevance_score=r.get("score", 0.0),
            )
            for r in raw.get("results", [])
        ]
        # Discard low-relevance results
        filtered = [r for r in all_results if r.relevance_score >= _RELEVANCE_THRESHOLD]

        ctx.deps.state_manager.log_step(Step(
            phase=LoopPhase.EXECUTE,
            action_type=ActionType.SEARCH,
            notes=f"{input.rationale} | query: {input.query}",
        ))
        return SearchOutput(
            query=input.query,
            results=filtered,
            total_found=len(filtered),
        )

    except Exception as exc:
        # Any Tavily error (missing key, 5xx, timeout) → graceful degradation
        ctx.deps.state_manager.log_step(Step(
            phase=LoopPhase.EXECUTE,
            action_type=ActionType.SEARCH,
            notes=f"ERROR: {type(exc).__name__}: {exc} | query: {input.query}",
        ))
        return SearchOutput(query=input.query, results=[], total_found=0)

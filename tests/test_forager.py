# tests/test_forager.py
"""
Tests for the Epistemic Forager.

Tavily is mocked — no real network calls in tests.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from reasoning_agent.schemas import SearchInput, SearchOutput


@pytest.fixture
def mock_tavily():
    """Mock TavilyClient.search() to return two results."""
    result = {
        "results": [
            {
                "title": "AI Market 2026",
                "url": "https://example.com/ai-market",
                "content": "The AI market is growing rapidly.",
                "score": 0.92,
            },
            {
                "title": "Low Relevance Article",
                "url": "https://example.com/low",
                "content": "Unrelated content.",
                "score": 0.15,   # below 0.3 threshold — should be discarded
            },
        ]
    }
    with patch("reasoning_agent.forager._get_tavily") as mock_getter:
        mock_client = MagicMock()
        mock_client.search = MagicMock(return_value=result)
        mock_getter.return_value = mock_client
        yield mock_getter


@pytest.mark.asyncio
async def test_tool_search_returns_results(mock_tavily):
    from reasoning_agent.forager import tool_search
    from reasoning_agent.schemas import SearchInput

    ctx = MagicMock()
    ctx.deps.state_manager.log_step = MagicMock()

    inp = SearchInput(query="AI market trends 2026", rationale="Not in training data")
    result = await tool_search(ctx, inp)

    assert isinstance(result, SearchOutput)
    assert result.query == "AI market trends 2026"
    assert len(result.results) >= 1


@pytest.mark.asyncio
async def test_tool_search_filters_low_relevance(mock_tavily):
    from reasoning_agent.forager import tool_search

    ctx = MagicMock()
    ctx.deps.state_manager.log_step = MagicMock()

    inp = SearchInput(query="AI market", rationale="test")
    result = await tool_search(ctx, inp)

    # score 0.15 result should be discarded
    for r in result.results:
        assert r.relevance_score >= 0.3


@pytest.mark.asyncio
async def test_tool_search_handles_missing_api_key():
    """If TAVILY_API_KEY is absent, returns empty SearchOutput without raising."""
    with patch("reasoning_agent.forager._get_tavily", side_effect=Exception("No API key")):
        from reasoning_agent.forager import tool_search

        ctx = MagicMock()
        ctx.deps.state_manager.log_step = MagicMock()

        inp = SearchInput(query="test", rationale="test")
        result = await tool_search(ctx, inp)

        assert isinstance(result, SearchOutput)
        assert result.results == []
        assert result.total_found == 0


@pytest.mark.asyncio
async def test_tool_search_handles_tavily_5xx(mock_tavily):
    """Tavily server error → empty SearchOutput, no exception propagated."""
    mock_tavily.return_value.search.side_effect = Exception("503 Service Unavailable")

    from reasoning_agent.forager import tool_search

    ctx = MagicMock()
    ctx.deps.state_manager.log_step = MagicMock()

    inp = SearchInput(query="test", rationale="test")
    result = await tool_search(ctx, inp)

    assert result.results == []

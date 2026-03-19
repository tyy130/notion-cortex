# Notion Cortex

A multi-agent AI research system where **Notion is the operating system** — not just the output destination. Agents coordinate through live Notion databases, stream reasoning to Working Memory pages as they think, and require your approval in Notion before producing a final brief.

Built for the [DEV × Notion MCP Challenge](https://dev.to/challenges/notion).

---

## How it works

```
notion-cortex "AI coding assistants market 2026"
```

1. **Bootstrap** — Creates five Notion databases under a parent page (idempotent; reuses existing ones)
2. **Decompose** — An LLM generates 5 specific research angles tailored to the topic
3. **Scout** (×5, parallel) — Each Scout agent fans out across an angle, uses `notion_search` via MCP to check existing knowledge, then writes extracted entities to the Knowledge Graph
4. **Analyst** — Reads all Scout findings, identifies patterns and gaps, enriches the Knowledge Graph
5. **Synthesizer** — Streams a structured synthesis across: executive summary, key players, trends, gaps, and recommendations — directly into a Notion page as it thinks
6. **Approval Gate** — Opens a Notion database entry for you to review. Set status to **Approved** to continue, **Rejected** to abort with notes
7. **Writer** — Produces a publication-ready intelligence brief with headings, entity table, and conclusions — saved as a Notion page

Every agent's live reasoning streams into its own **Working Memory** page in real time. The **Task Bus** tracks agent status. The **Knowledge Graph** accumulates structured entities across the run.

---

## Prerequisites

- Node.js 20+
- A [Notion integration](https://www.notion.so/my-integrations) with read/write access to a parent page
- An OpenAI API key (or Anthropic, see [Providers](#providers))

---

## Installation

```bash
npm install -g notion-cortex
```

Or run from source:

```bash
git clone <repo-url>
cd notion-cortex
npm install
npm run build
npm link
```

---

## Setup

Run the interactive setup wizard once:

```bash
notion-cortex setup
```

This walks you through:
- LLM provider (OpenAI or Anthropic)
- API key
- Notion integration token
- Notion parent page ID (the page where Cortex will create its databases)

Credentials are saved to `~/.notion-cortex.json` (mode 600). Environment variables and `.env` always take precedence over the saved config.

**Finding your Notion parent page ID:**
Open the target page in Notion → click `···` → Copy link → the 32-character hex string at the end is the page ID.

---

## Usage

```bash
# Interactive — prompts for topic
notion-cortex

# Direct topic
notion-cortex "quantum computing landscape 2026"

# Skip approval gate (useful for automation)
notion-cortex "electric vehicle battery technology" --auto-approve
```

---

## Example run

```
$ notion-cortex "AI coding assistants market 2026"

🧠 Notion Cortex — starting run for: "AI coding assistants market 2026"

📋 Bootstrapping Notion workspace...
✅ Workspace ready (1.2s)

🧩 Decomposing topic into research angles...
   5 angles identified:
   1. Key players and market share: GitHub Copilot, Cursor, Tabnine, Amazon CodeWhisperer
   2. Pricing models and enterprise adoption barriers in 2026
   3. Technical differentiation: context windows, multi-file editing, agent modes
   4. Developer sentiment and productivity benchmarks
   5. Regulatory and IP concerns around AI-generated code

🔍 Creating 5 research tasks...

🚀 Running 5 Scout agents (concurrency: 3)...

  🔎 Scout 1 → https://notion.so/3273f827-...
  🔎 Scout 2 → https://notion.so/3273f827-...
  🔎 Scout 3 → https://notion.so/3273f827-...
  ✅ Scout 1 done
  ✅ Scout 2 done
  ✅ Scout 3 done
  🔎 Scout 4 → https://notion.so/3273f827-...
  🔎 Scout 5 → https://notion.so/3273f827-...
  ✅ Scout 4 done
  ✅ Scout 5 done

📊 All Scouts complete (47.3s). Running Analyst...

✅ Analyst done (18.1s)

🕸️  Computing knowledge graph relations...
✅ Relations linked (2.4s)

🔗 Running Synthesizer...

✅ Synthesis written → https://notion.so/3273f827-... (22.6s)

⏸  Awaiting approval — open cortex-approval-gates in Notion:
   https://notion.so/3273f827-...
   Find "Approve synthesis for: AI coding assistants market 2026..."
   Review the synthesis link in the Notes field, then set Status → Approved

✅ Approved!

✍️  Running Writer...

✅ Writer done (14.2s)

🎉 Done in 104.7s! Intelligence brief: https://notion.so/3273f827-...
```

The final brief is a structured Notion page with headings, entity tables, and actionable conclusions. The `cortex-knowledge-graph` database accumulates 20+ typed entities (products, companies, trends, concepts) with auto-linked relations. Every agent's live reasoning is readable in `cortex-working-memory`.

---

## Workspace structure

On first run, Cortex creates five databases under your parent page:

| Database | Purpose |
|---|---|
| `cortex-task-bus` | Agent task queue with status tracking |
| `cortex-working-memory` | Live reasoning pages streamed by each agent |
| `cortex-knowledge-graph` | Structured entities extracted from research |
| `cortex-approval-gates` | Human review checkpoints |
| `cortex-outputs` | Final intelligence briefs |

Subsequent runs on the same parent page reuse these databases — they accumulate knowledge across runs.

---

## Providers

Cortex supports two LLM providers:

| Provider | Fast model | Capable model |
|---|---|---|
| `openai` (default) | `gpt-4o-mini` | `gpt-4o` |
| `anthropic` | `claude-haiku-4-5-20251001` | `claude-opus-4-6` |

Switch providers via the setup wizard or environment variable:

```bash
# The Anthropic SDK is an optional dependency — install it first:
npm install @anthropic-ai/sdk

CORTEX_PROVIDER=anthropic notion-cortex "your topic"
```

Override individual models:

```env
CORTEX_FAST_MODEL=gpt-4o-mini
CORTEX_CAPABLE_MODEL=gpt-4o
CORTEX_HAIKU_MODEL=claude-haiku-4-5-20251001
CORTEX_OPUS_MODEL=claude-opus-4-6
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NOTION_API_KEY` | — | Notion integration token |
| `NOTION_PARENT_PAGE_ID` | — | Parent page for Cortex databases |
| `CORTEX_PROVIDER` | `openai` | LLM provider: `openai` or `anthropic` |
| `OPENAI_API_KEY` | — | Required when provider is `openai` |
| `ANTHROPIC_API_KEY` | — | Required when provider is `anthropic` |
| `CORTEX_FAST_MODEL` | `gpt-4o-mini` | Model for Scout agents |
| `CORTEX_CAPABLE_MODEL` | `gpt-4o` | Model for Analyst, Synthesizer, Writer |
| `CORTEX_SCOUT_CONCURRENCY` | `3` | Max parallel Scout agents |
| `CORTEX_STREAM_FLUSH_MS` | `1000` | How often to flush tokens to Notion (ms) |
| `CORTEX_APPROVAL_POLL_MAX_S` | `3600` | Max seconds to wait for approval |
| `CORTEX_LLM_TIMEOUT_MS` | `300000` | Max ms for any single LLM call (5 min) |

---

## Development

```bash
npm install
cp .env.example .env   # fill in your keys
npm run dev -- "your topic"

# Tests
npm test

# Type check
npm run build

# Clean up Cortex databases (archives all cortex-* databases from parent page)
npm run cleanup
```

---

## Architecture

```
src/
  index.ts              CLI entry point + setup wizard
  cleanup.ts            Archives all cortex-* databases for a fresh start
  orchestrator.ts       Pipeline coordinator
  llm.ts                Dual-provider streaming abstraction (OpenAI + Anthropic)
  streaming.ts          Token buffer → timed Notion block flush
  concurrency.ts        Write queue (p-limit) + exponential backoff retry
  types.ts              Zod schemas for all database entry types
  agents/
    scout.ts            Research agent — uses Notion MCP tools + entity extraction
    analyst.ts          Cross-scout analysis + knowledge graph enrichment
    synthesizer.ts      Structured synthesis streamed to Working Memory
    writer.ts           Final brief written to Outputs database
  notion/
    bootstrap.ts        Idempotent 5-database workspace creation
    client.ts           Notion SDK singleton
    mcp-client.ts       Notion MCP server (stdio transport)
    task-bus.ts         Agent task queue CRUD
    working-memory.ts   Streaming page writer + content reader
    knowledge-graph.ts  Entity store with serialised upsert
    approval-gates.ts   Human-in-the-loop polling
    outputs.ts          Final page publisher
    markdown-blocks.ts  Markdown → Notion block converter
    utils.ts            Shared helpers (notionUrl)
```

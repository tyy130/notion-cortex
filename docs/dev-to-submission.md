---
title: "Notion Cortex: A Multi-Agent AI Research System Where Notion Is the Operating System"
published: false
description: "5 AI agents coordinate through live Notion databases to produce intelligence briefs — with streaming working memory, a knowledge graph, and human-in-the-loop approval."
tags: devchallenge, notionchallenge, mcp, ai
cover_image:
---

*This is a submission for the [Notion MCP Challenge](https://dev.to/challenges/notion-2026-03-04)*

## What I Built

**Notion Cortex** is a multi-agent AI research system that uses Notion as its operating system — not just an output destination, but the shared coordination layer where agents think, communicate, and await human approval.

Give it any topic, and five specialized AI agents fan out in parallel:

1. **Scout agents** (x5) research different angles simultaneously, extracting structured entities into a Knowledge Graph
2. **Analyst** cross-references all findings, identifies patterns and gaps
3. **Synthesizer** streams a structured synthesis directly into Notion as it thinks
4. **Approval Gate** pauses execution and waits for you to review in Notion — set Status to "Approved" to continue
5. **Writer** produces a publication-ready intelligence brief with headings, entity tables, and conclusions

Every agent's reasoning streams into its own **Working Memory** page in real time. You can literally watch them think in Notion.

```
$ notion-cortex "The rise of autonomous AI agents in software engineering"

🧠 Notion Cortex — starting run for: "The rise of autonomous AI agents..."

📋 Bootstrapping Notion workspace...
✅ Workspace ready (1.6s)

🧩 Decomposing topic into research angles...
   5 angles identified

🚀 Running 5 Scout agents (concurrency: 3)...
  ✅ Scout 1 done
  ✅ Scout 2 done
  ...

📊 All Scouts complete (103s). Running Analyst...
✅ Analyst done (31s)

🕸️  Computing knowledge graph relations...
✅ Relations linked (8s)

🔗 Running Synthesizer...
✅ Synthesis written (23s)

✍️  Running Writer...
✅ Writer done (43s)

🎉 Done in 229s! Intelligence brief: https://notion.so/...
```

### The Notion Workspace After a Run

**Cortex parent page — all 5 databases auto-created:**

![Cortex workspace showing 5 databases](https://raw.githubusercontent.com/tyy130/notion-cortex/main/docs/screenshots/01-workspace.png?v=2)

**cortex-knowledge-graph — entities with sources, confidence, and auto-linked relations:**

![Knowledge graph with entities and sources](https://raw.githubusercontent.com/tyy130/notion-cortex/main/docs/screenshots/02-knowledge-graph.png?v=2)

**cortex-task-bus — every agent's task tracked with status and priority:**

![Task bus showing 8 completed tasks](https://raw.githubusercontent.com/tyy130/notion-cortex/main/docs/screenshots/03-task-bus.png?v=2)

**cortex-working-memory — each agent's live reasoning with token counts:**

![Working memory with 8 agent pages](https://raw.githubusercontent.com/tyy130/notion-cortex/main/docs/screenshots/04-working-memory.png?v=2)

**Intelligence Brief — structured output with headings, entity table, and conclusions:**

![Intelligence brief with executive summary](https://raw.githubusercontent.com/tyy130/notion-cortex/main/docs/screenshots/05-brief-top.png?v=2)

![Brief continued — entity table and conclusions](https://raw.githubusercontent.com/tyy130/notion-cortex/main/docs/screenshots/06-brief-table.png?v=2)

---

## Video Demo

{% embed https://asciinema.org/a/rZU5tivnEZXeN5Na %}

The demo shows a complete run from `notion-cortex "topic"` through all 5 agent phases to the final intelligence brief in Notion.

---

## Show us the code

**GitHub**: [github.com/tyy130/notion-cortex](https://github.com/tyy130/notion-cortex)

### Architecture

```
src/
  index.ts              CLI entry point + setup wizard
  cleanup.ts            Archives all cortex-* databases for a fresh start
  orchestrator.ts       Pipeline coordinator
  llm.ts                Dual-provider streaming (OpenAI + Anthropic)
  streaming.ts          Token buffer → timed Notion block flush
  concurrency.ts        Write queue (p-limit) + exponential backoff retry
  types.ts              Zod schemas for all database entry types
  agents/
    scout.ts            Research + entity extraction via MCP
    analyst.ts          Cross-scout analysis + KG enrichment
    synthesizer.ts      Structured synthesis streamed to Working Memory
    writer.ts           Final brief written to Outputs database
  notion/
    bootstrap.ts        Idempotent 5-database workspace creation
    client.ts           Notion SDK singleton
    mcp-client.ts       Notion MCP server (stdio transport)
    task-bus.ts         Agent task queue CRUD
    working-memory.ts   Streaming page writer + content reader
    knowledge-graph.ts  Entity store with serialized upsert
    approval-gates.ts   Human-in-the-loop polling
    outputs.ts          Final page publisher
    markdown-blocks.ts  Markdown → Notion block converter
    utils.ts            Shared helpers
```

### Key Technical Decisions

**Serialized KG upsert**: Parallel scouts can discover the same entity simultaneously. A `pLimit(1)` queue wraps the check-then-create operation, making the upsert atomic without a database lock.

**Two-queue concurrency design**: `writeQueue` (pLimit(3)) handles Notion API rate limiting. `kgUpsertQueue` (pLimit(1)) handles logical atomicity. Different concerns, different queues.

**Idempotent bootstrap with archived filtering**: `bootstrapWorkspace` searches for existing `cortex-*` databases and reuses them. It filters out archived databases (Notion's search API returns them by default) and uses `databases.update` to ensure schema migrations apply to pre-existing databases.

**Dual-provider LLM abstraction**: Supports OpenAI (default) and Anthropic with streaming and multi-turn tool-use loops. Switch with one env var.

**55 tests across 13 files**: Full coverage of the orchestrator pipeline, all agents, concurrency utilities, markdown converter, and Notion data layer.

### Quick Start

```bash
git clone https://github.com/tyy130/notion-cortex.git
cd notion-cortex
npm install
notion-cortex setup    # interactive wizard
notion-cortex "your research topic"
```

---

## How I Used Notion MCP

Notion isn't just where output ends up — it's the runtime substrate. The **Notion MCP server** (`@notionhq/notion-mcp-server`) runs as a stdio subprocess, giving Scout agents access to `notion_search` — they check what knowledge already exists in the workspace before extracting new entities, avoiding redundant work across runs.

Beyond MCP search, each database works as infrastructure through the Notion SDK:

### 1. Task Bus (agent coordination)
The orchestrator creates tasks, scouts claim them via `assigned_agent`, and status transitions (`pending → active → done → blocked`) drive the pipeline forward. This is a distributed task queue implemented entirely in Notion.

### 2. Working Memory (streaming scratchpad)
Each agent gets a dedicated Notion page. As tokens stream from the LLM, a timed buffer flushes them as paragraph blocks to the page every second. You can open a scout's Working Memory page and watch it think in real time.

### 3. Knowledge Graph (structured entity store)
Scouts extract entities (companies, products, trends, concepts) with claims, confidence levels, and source URLs. A serialized upsert queue (`pLimit(1)`) prevents duplicate entities when parallel scouts find the same thing. After the Analyst pass, `computeAndStoreRelations` scans all entities and auto-links them using Notion's relation property — if "GitHub Copilot" appears in another entity's claim, they get linked.

### 4. Approval Gates (human-in-the-loop)
Before the Writer runs, an approval gate creates a Notion database entry with status "Pending" and a link to the synthesis. The system polls with exponential backoff until you change the status to "Approved" or "Rejected" in Notion. This is genuine human-in-the-loop control — not a dialog box, but a Notion workflow.

### 5. Outputs (final deliverables)
The Writer converts its markdown output into native Notion blocks — headings, bullet lists, numbered lists, tables, code blocks, bold/italic, and links — using a custom `markdownToNotionBlocks` converter. The result is a proper Notion page, not a pasted text blob.

---

## Final Thoughts

The most surprising thing about this project was how naturally Notion works as an agent coordination layer. Databases become task queues. Pages become working memory. Relations become a knowledge graph. Status properties become approval gates. It's not a hack — it's genuinely the right tool for this.

The human-in-the-loop approval gate is my favorite feature. Most agent systems are either fully autonomous or require you to babysit a terminal. With Cortex, you get a Notion notification, review the synthesis at your own pace, and approve when ready. The agents wait patiently.

MIT licensed. PRs welcome.

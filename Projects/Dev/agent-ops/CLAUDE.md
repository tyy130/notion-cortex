# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

`agent-ops` is a **post-agentic CLI tooling monorepo** by tacticdev. It ships 30 focused modules covering the gaps that matter after basic "edit files and run commands" agents: governance, reliability, safety, economics, artifact-first UX, and interoperability. Each module is a standalone package under `packages/` and published independently.

## Repo Structure

Monorepo layout (target):

```
packages/
  action-ledger/       # governance: append-only JSONL audit log
  permission-gate/     # governance: allowlist/denylist RBAC
  approval-queue/      # governance: human-in-the-loop risky actions
  policy-pack/         # governance: YAML policy enforcement
  prompt-provenance/   # governance: prompt versioning + change attribution
  agent-regression/    # reliability: replay saved task suites vs goldens
  diff-quality-scorer/ # reliability: PR risk scoring (auth, payments, etc.)
  test-coverage-coach/ # reliability: untested-area finder + checklist gen
  failure-taxonomy/    # reliability: classify agent failures by type
  deterministic-gate/  # reliability: schema + lint + typecheck + test gate
  dry-run-sandbox/     # safety: containerized diff-only run
  secrets-redactor/    # safety: scrub logs/env/config dumps
  command-risk-scorer/ # safety: risk-score commands + escalation thresholds
  tool-boundary-tester/# safety: sandbox probe + capability matrix
  rollback-pack/       # safety: auto undo-plan (git branch, checkpoints)
  model-router/        # economics: route by task class + budget
  token-cost-dash/     # economics: per-task/repo/model spend tracking
  budget-throttle/     # economics: daily cap + auto model downgrade
  latency-profiler/    # economics: think vs tool vs retry timing
  caching-layer/       # economics: semantic cache for repeated queries
  plan-to-markdown/    # artifact UX: plans saved as repo markdown docs
  trace-viewer/        # artifact UX: web UI for steps, tool calls, diffs
  decision-cards/      # artifact UX: "why this change" cards per PR chunk
  change-narrative/    # artifact UX: release-note style diff summaries
  context-pack-builder/# artifact UX: bundle relevant files + prior decisions
  mcp-connector-kit/   # interop: MCP server templates (fs, tickets, notes)
  github-pr-butler/    # interop: labeler + reviewer suggestion + checklists
  slack-escalation/    # interop: post approval requests with diff snippets
  plugin-system/       # interop: drop-in capability plugin architecture
  workspace-bootstrapper/ # interop: standard agent-ops repo scaffolding
```

## Module Conventions

Each package follows this layout:

```
packages/<name>/
  src/
    index.ts          # main export
    types.ts          # shared types for this module
  tests/
    <name>.test.ts
  package.json        # name: @agent-ops/<name>
  README.md           # one-screen purpose + usage
  tsconfig.json       # extends ../../tsconfig.base.json
```

All packages use the `@agent-ops/` npm scope.

## Stack

- **Runtime**: Node.js + TypeScript
- **Testing**: Vitest (`pnpm test`, `pnpm test --run packages/<name>`)
- **Linting**: ESLint + Prettier (`pnpm lint`, `pnpm format`)
- **Build**: `pnpm build` (tsc per package, or turborepo if added)
- **Firebase**: Present (firebase-debug.log exists) — likely for `trace-viewer` backend or token-cost-dash persistence
- **Playwright**: Enabled for browser-facing modules (trace-viewer, dashboards)

## Common Commands

```bash
pnpm install               # install all workspace deps
pnpm build                 # build all packages
pnpm test                  # run all tests (vitest)
pnpm test --run packages/action-ledger  # run one package's tests
pnpm lint                  # lint all packages
pnpm format                # format with prettier
```

> These commands assume a pnpm workspace root is set up. If not yet initialized, run `pnpm init` + add `pnpm-workspace.yaml`.

## Architecture Principles

**Modules are composable, not coupled.** Each package works standalone. Higher-order compositions (e.g., `deterministic-gate` calling `command-risk-scorer`) happen via published interfaces, not internal imports.

**JSONL is the interchange format** for audit-heavy modules (action-ledger, trace-viewer, failure-taxonomy). Prefer streaming append over bulk writes.

**Policy as config, not code.** Governance modules (`policy-pack`, `permission-gate`) read YAML/JSON config files so policies can be changed without redeployment.

**Risk scoring is a first-class concern.** Several modules (`diff-quality-scorer`, `command-risk-scorer`) produce numeric risk scores. Score thresholds are configurable; defaults ship conservatively (require approval above 0.7).

**MCP-first interop.** Where external integrations exist, prefer MCP server interfaces over bespoke SDKs. `mcp-connector-kit` provides the templates.

## Module Categories

| Category | Focus |
|---|---|
| Governance | Auditability, permissions, policy enforcement |
| Reliability | Evals, regression, deterministic validation |
| Safety | Sandboxing, secrets, rollback |
| Economics | Cost, routing, budget controls |
| Artifact UX | Plans, traces, narratives, context packs |
| Interop | MCP, GitHub, Slack, plugins |

## Data Formats

- **Audit logs**: JSONL with fields `timestamp`, `session_id`, `tool`, `input`, `output`, `outcome`
- **Risk scores**: `{ score: number, factors: string[], threshold: number, action: "allow" | "escalate" | "block" }`
- **Plans**: Markdown saved to `plans/YYYY-MM-DD-<slug>.md` in the repo
- **Traces**: JSON or JSONL with `step`, `duration_ms`, `tool_calls[]`, `diff_summary`

# Copilot Instructions for `@agent-ops/action-ledger`

For repo-wide context and conventions, also follow `../../.github/copilot-instructions.md`.

## Build, test, and lint

```bash
cd packages/action-ledger
pnpm build
pnpm test
pnpm lint
pnpm test -- tests/action-ledger.test.ts
```

From repo root, package-targeted tests can also run with:

```bash
pnpm test --run packages/action-ledger
```

## High-level architecture

- `action-ledger` is the governance package for append-only JSONL audit logging of tool calls, diffs, commands, and outcomes.
- Core contracts live in `src/types.ts` (`LedgerEntry`, `LedgerConfig`, and `Outcome`).
- Session identity utilities are in `src/session.ts` (`generateSessionId`, `getSessionId`) with a per-process lazy session ID.

## Key conventions

- Preserve the audit record field names and shape in `LedgerEntry` (including `session_id` and `duration_ms`).
- Keep outcome values constrained to `'success' | 'error' | 'blocked' | 'skipped'`.
- Keep `src/index.ts` as the package export surface and intentionally export any new runtime APIs there.

# @agent-ops/action-ledger

> Append-only JSONL log of every tool call, file diff, command, and outcome

Part of the [agent-ops](../../README.md) monorepo — **governance** category.

## Install

```bash
pnpm add @agent-ops/action-ledger
```

## Usage

```ts
import { createLedger } from '@agent-ops/action-ledger';

const ledger = createLedger({ logPath: '.agent-ops/ledger.jsonl' });

await ledger.record({
  tool: 'Bash',
  input: { command: 'pnpm test' },
  output: '3 tests passed',
  outcome: 'success',
  duration_ms: 412,
});
```

## Config

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `logPath` | `string` | required | Path to JSONL output file |
| `maxOutputBytes` | `number` | `4096` | Truncate output beyond this size |
| `maxPendingWrites` | `number` | `1024` | Backpressure cap for queued write operations |
| `sessionId` | `string` | auto UUID | Override session identifier |
| `schemaVersion` | `string` | `1.0.0` | Schema version emitted per entry |
| `signingSecret` | `string` | unset | HMAC-sign every entry for tamper evidence |
| `signingKeyId` | `string` | unset | Key identifier written on signed entries for rotation |
| `approvalThreshold` | `number` | unset | Require explicit approval at/above this risk score |
| `resumeChain` | `boolean` | `true` | Resume chain from the last entry in existing log |

## Phase 3 hardening (immutable chain + approval gate)

```ts
import { createLedger, verifyLedgerEntrySignature } from '@agent-ops/action-ledger';

const ledger = createLedger({
  logPath: '.agent-ops/ledger.jsonl',
  signingSecret: process.env.LEDGER_SIGNING_SECRET,
  approvalThreshold: 0.7,
});

await ledger.record({
  tool: 'Bash',
  input: { command: 'deploy --prod' },
  outcome: 'success',
  risk_score: 0.9,
  approved: false,
});

// Resulting entry is written as blocked with approval metadata, chain hash, and signature.
```

Each entry now includes tamper-evidence fields:
- `chain_prev_hash`
- `chain_hash`
- `signature` (when `signingSecret` is set)

Use `verifyLedgerEntrySignature(entry, signingSecret)` to validate entry signatures.

## Phase 4 productionization (resume + key rotation + file verification)

```ts
import { createLedger, verifyLedgerFile } from '@agent-ops/action-ledger';

const ledger = createLedger({
  logPath: '.agent-ops/ledger.jsonl',
  signingSecret: process.env.LEDGER_SIGNING_SECRET,
  signingKeyId: 'key-2026-02',
  resumeChain: true,
});

await ledger.record({
  tool: 'Bash',
  input: { command: 'deploy --prod' },
  outcome: 'success',
});

const report = await verifyLedgerFile('.agent-ops/ledger.jsonl', {
  signingSecretsByKeyId: {
    'key-2026-02': process.env.LEDGER_SIGNING_SECRET ?? '',
  },
  requireSignatures: true,
});
```

`verifyLedgerFile` checks:
- hash chain integrity (`chain_prev_hash` / `chain_hash`)
- signature validity (with optional key-ID based secret selection)
- signature presence when `requireSignatures` is enabled

## Phase 5 governance integrations (permission-gate + approval-queue)

```ts
import { createLedger } from '@agent-ops/action-ledger';

const ledger = createLedger({
  logPath: '.agent-ops/ledger.jsonl',
  approvalThreshold: 0.7,
  permissionGate: async ({ tool, input }) => {
    // Wire to @agent-ops/permission-gate when available
    const command = String(input.command ?? '');
    const blocked = tool === 'Bash' && command.includes('deploy --prod');
    return blocked
      ? { allowed: false, reason: 'production deploy denied for this role', policy_id: 'prod-deny', role: 'guest' }
      : { allowed: true, role: 'operator' };
  },
  approvalQueue: async ({ risk_score }) => {
    // Wire to @agent-ops/approval-queue when available
    if (risk_score >= 0.9) {
      return { approved: false, request_id: 'apr-123', reason: 'manual approval required' };
    }
    return { approved: true, request_id: 'apr-auto' };
  },
});
```

Behavior:
- Permission denial produces a `blocked` entry with `permission_*` metadata.
- High-risk records can escalate through approval queue and include `approval_request_id`.

## Phase 6 release hardening (schema policy + verification CLI)

Verify ledger integrity in CI/release pipelines:

```bash
pnpm --filter @agent-ops/action-ledger build
node packages/action-ledger/dist/cli/verify-ledger.js .agent-ops/ledger.jsonl \
  --require-signatures \
  --key-secret key-2026-02="$LEDGER_SIGNING_SECRET" \
  --accept-schema 1.0.0 \
  --disallow-missing-schema
```

CLI exit codes:
- `0` = verification passed
- `1` = verification failed (integrity/signature/schema policy errors)

Recommended release checklist:
- Run `pnpm build && pnpm test && pnpm lint` in `packages/action-ledger`
- Verify sample production ledger with `verify-ledger` CLI
- Pin accepted schema versions (`--accept-schema`) for release windows
- Keep rotation map updated (`--key-secret keyId=secret`) before key changes

## Phase 7 operational scale (batch writes + backpressure + streaming verify)

```ts
import { createLedger, verifyLedgerFile } from '@agent-ops/action-ledger';

const ledger = createLedger({
  logPath: '.agent-ops/ledger.jsonl',
  maxPendingWrites: 2048,
});

await ledger.recordMany([
  { tool: 'Bash', input: { command: 'echo one' }, outcome: 'success' },
  { tool: 'Bash', input: { command: 'echo two' }, outcome: 'success' },
]);

const report = await verifyLedgerFile('.agent-ops/ledger.jsonl', {
  maxErrors: 20,
});
```

Operational behavior:
- `recordMany` batches append operations for better throughput.
- Backpressure guard throws when queued writes exceed `maxPendingWrites`.
- `verifyLedgerFile` now streams large logs line-by-line instead of loading full files into memory.

## Phase 8 ecosystem rollout (interop adapters + publish hardening)

Interoperability adapters:

```ts
import {
  classifyFailure,
  toDecisionCard,
  toTraceStep,
  type LedgerEntry,
} from '@agent-ops/action-ledger';

const entry = {} as LedgerEntry;
const traceStep = toTraceStep(entry);        // trace-viewer friendly shape
const failure = classifyFailure(entry);      // failure-taxonomy category
const decisionCard = toDecisionCard(entry);  // decision-cards summary
```

Publish hardening now includes:
- explicit `exports` map (root + CLI entrypoints)
- constrained `files` allowlist (`dist`, `README.md`)
- `sideEffects: false` for tree-shaking safety

## Unified hook integration (Claude, Copilot, Gemini, Codex, Aider)

Build the package, then pipe hook payload JSON into the unified hook command:

```bash
pnpm --filter @agent-ops/action-ledger build
echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"output":"ok","is_error":false}}' \
  | AGENT_OPS_HOOK_SOURCE=claude node packages/action-ledger/dist/cli/unified-hook.js
```

Environment variables:

- `AGENT_OPS_LOG_PATH` (default: `.agent-ops/ledger.jsonl`)
- `AGENT_OPS_HOOK_SOURCE` (`claude | copilot | gemini | codex | aider | unknown`)
- `AGENT_OPS_MAX_OUTPUT_BYTES` (optional positive integer)

### Source-specific payload examples

Claude:

```json
{"tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"output":"ok","is_error":false}}
```

Copilot:

```json
{"toolName":"Read","toolInput":{"path":"src/index.ts"},"toolOutput":{"output":"...","isError":false}}
```

Gemini:

```json
{"functionCall":{"name":"search","arguments":"{\"query\":\"agent ops\"}"},"response":{"output":"found"}}
```

Codex:

```json
{"source":"codex","tool":"edit_file","arguments":{"path":"src/index.ts"},"result":{"output":"patched"}}
```

Aider:

```json
{"command":"pytest -q","stdout":"2 failed","stderr":"traceback","exit_code":1}
```

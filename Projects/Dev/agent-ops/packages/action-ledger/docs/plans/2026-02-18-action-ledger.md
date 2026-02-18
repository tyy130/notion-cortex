# Action Ledger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an append-only JSONL audit log that records every tool call, file diff, command, and outcome for any agent session.

**Architecture:** A lightweight `ActionLedger` class wraps a streaming JSONL writer. Each entry is stamped with a session UUID (generated once per process, optionally persisted). A Claude Code `PostToolUse` hook wires it to any agent session without requiring code changes in the agent itself.

**Tech Stack:** TypeScript, Node.js built-ins (`fs/promises`, `crypto`), Vitest

---

### Task 1: Define types

**Files:**
- Modify: `packages/action-ledger/src/types.ts`

**Step 1: Write the failing test**

In `packages/action-ledger/tests/action-ledger.test.ts`, replace the stub:

```typescript
import { describe, it, expect } from 'vitest';
import type { LedgerEntry, LedgerConfig } from '../src/types';

describe('types', () => {
  it('LedgerEntry has required fields', () => {
    const entry: LedgerEntry = {
      timestamp: new Date().toISOString(),
      session_id: 'abc-123',
      tool: 'Bash',
      input: { command: 'ls' },
      output: 'file.txt',
      outcome: 'success',
    };
    expect(entry.timestamp).toBeDefined();
    expect(entry.session_id).toBeDefined();
  });

  it('LedgerConfig has logPath and optional fields', () => {
    const config: LedgerConfig = { logPath: '.agent-ops/ledger.jsonl' };
    expect(config.logPath).toBe('.agent-ops/ledger.jsonl');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: FAIL — `LedgerEntry` not exported

**Step 3: Implement types**

Replace `packages/action-ledger/src/types.ts`:

```typescript
export type Outcome = 'success' | 'error' | 'blocked' | 'skipped';

export interface LedgerEntry {
  timestamp: string;        // ISO 8601
  session_id: string;       // UUID per process
  tool: string;             // e.g. "Bash", "Edit", "Read"
  input: Record<string, unknown>;
  output?: string;          // truncated stdout/result
  diff?: string;            // unified diff for file edits
  outcome: Outcome;
  error?: string;           // error message if outcome === 'error'
  duration_ms?: number;     // wall time for the tool call
}

export interface LedgerConfig {
  logPath: string;          // path to .jsonl file, e.g. ".agent-ops/ledger.jsonl"
  maxOutputBytes?: number;  // truncate output at this size (default: 4096)
  sessionId?: string;       // override auto-generated UUID
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/action-ledger/src/types.ts packages/action-ledger/tests/action-ledger.test.ts
git commit -m "feat(action-ledger): define LedgerEntry and LedgerConfig types"
```

---

### Task 2: Session ID

**Files:**
- Create: `packages/action-ledger/src/session.ts`

**Step 1: Write the failing test**

Add to `tests/action-ledger.test.ts`:

```typescript
import { generateSessionId, getSessionId } from '../src/session';

describe('session', () => {
  it('generateSessionId returns a UUID-shaped string', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('getSessionId returns the same value on repeated calls', () => {
    const a = getSessionId();
    const b = getSessionId();
    expect(a).toBe(b);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: FAIL — `generateSessionId` not found

**Step 3: Implement session.ts**

Create `packages/action-ledger/src/session.ts`:

```typescript
import { randomUUID } from 'crypto';

// Lazily generated once per process lifetime
let _sessionId: string | undefined;

export function generateSessionId(): string {
  return randomUUID();
}

export function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = generateSessionId();
  }
  return _sessionId;
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/action-ledger/src/session.ts packages/action-ledger/tests/action-ledger.test.ts
git commit -m "feat(action-ledger): session UUID generation"
```

---

### Task 3: Append-only JSONL writer

**Files:**
- Create: `packages/action-ledger/src/writer.ts`

**Step 1: Write the failing test**

Add to `tests/action-ledger.test.ts`:

```typescript
import { appendEntry } from '../src/writer';
import { readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('writer', () => {
  it('appends valid JSONL lines to a file', async () => {
    const logPath = join(tmpdir(), `ledger-test-${Date.now()}.jsonl`);
    const entry = {
      timestamp: '2026-02-18T00:00:00.000Z',
      session_id: 'test-session',
      tool: 'Bash',
      input: { command: 'ls' },
      output: 'file.txt',
      outcome: 'success' as const,
    };

    await appendEntry(logPath, entry);
    await appendEntry(logPath, { ...entry, tool: 'Read' });

    const contents = await readFile(logPath, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tool).toBe('Bash');
    expect(JSON.parse(lines[1]).tool).toBe('Read');

    await unlink(logPath);
  });

  it('creates parent directories if they do not exist', async () => {
    const logPath = join(tmpdir(), `ledger-nested-${Date.now()}`, 'ledger.jsonl');
    const entry = {
      timestamp: '2026-02-18T00:00:00.000Z',
      session_id: 's',
      tool: 'Test',
      input: {},
      outcome: 'success' as const,
    };
    await appendEntry(logPath, entry);
    const contents = await readFile(logPath, 'utf8');
    expect(JSON.parse(contents.trim()).tool).toBe('Test');
    await unlink(logPath);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: FAIL — `appendEntry` not found

**Step 3: Implement writer.ts**

Create `packages/action-ledger/src/writer.ts`:

```typescript
import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { LedgerEntry } from './types';

export async function appendEntry(logPath: string, entry: LedgerEntry): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8');
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/action-ledger/src/writer.ts packages/action-ledger/tests/action-ledger.test.ts
git commit -m "feat(action-ledger): append-only JSONL writer"
```

---

### Task 4: Diff utility

**Files:**
- Create: `packages/action-ledger/src/diff.ts`

**Step 1: Write the failing test**

Add to `tests/action-ledger.test.ts`:

```typescript
import { computeDiff } from '../src/diff';

describe('diff', () => {
  it('returns null when content is unchanged', () => {
    expect(computeDiff('a.ts', 'same', 'same')).toBeNull();
  });

  it('returns a unified diff string when content differs', () => {
    const result = computeDiff('a.ts', 'old line', 'new line');
    expect(result).toContain('-old line');
    expect(result).toContain('+new line');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: FAIL — `computeDiff` not found

**Step 3: Implement diff.ts**

Create `packages/action-ledger/src/diff.ts`:

```typescript
// Minimal unified diff — no external deps, handles single-file before/after
export function computeDiff(
  filename: string,
  before: string,
  after: string,
): string | null {
  if (before === after) return null;

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  const removed = beforeLines
    .filter((l) => !afterLines.includes(l))
    .map((l) => `-${l}`);
  const added = afterLines
    .filter((l) => !beforeLines.includes(l))
    .map((l) => `+${l}`);

  return [`--- ${filename}`, `+++ ${filename}`, ...removed, ...added].join('\n');
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/action-ledger/src/diff.ts packages/action-ledger/tests/action-ledger.test.ts
git commit -m "feat(action-ledger): file diff utility"
```

---

### Task 5: ActionLedger class

**Files:**
- Modify: `packages/action-ledger/src/index.ts`

**Step 1: Write the failing test**

Add to `tests/action-ledger.test.ts`:

```typescript
import { createLedger } from '../src/index';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ActionLedger', () => {
  it('records a tool call and writes it to the log', async () => {
    const logPath = join(tmpdir(), `ledger-class-${Date.now()}.jsonl`);
    const ledger = createLedger({ logPath });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'echo hello' },
      output: 'hello',
      outcome: 'success',
    });

    const contents = await readFile(logPath, 'utf8');
    const entry = JSON.parse(contents.trim());
    expect(entry.tool).toBe('Bash');
    expect(entry.session_id).toBeDefined();
    expect(entry.timestamp).toBeDefined();

    await unlink(logPath);
  });

  it('truncates output beyond maxOutputBytes', async () => {
    const logPath = join(tmpdir(), `ledger-trunc-${Date.now()}.jsonl`);
    const ledger = createLedger({ logPath, maxOutputBytes: 10 });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'cat big.txt' },
      output: 'a'.repeat(100),
      outcome: 'success',
    });

    const contents = await readFile(logPath, 'utf8');
    const entry = JSON.parse(contents.trim());
    expect(entry.output.length).toBeLessThanOrEqual(13); // 10 + "...[truncated]"

    await unlink(logPath);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: FAIL — `createLedger` not found

**Step 3: Implement ActionLedger in index.ts**

Replace `packages/action-ledger/src/index.ts`:

```typescript
// @agent-ops/action-ledger
// Append-only JSONL log of every tool call, file diff, command, and outcome

export * from './types';
export { generateSessionId, getSessionId } from './session';
export { appendEntry } from './writer';
export { computeDiff } from './diff';

import { appendEntry } from './writer';
import { getSessionId } from './session';
import type { LedgerConfig, LedgerEntry, Outcome } from './types';

const DEFAULT_MAX_OUTPUT_BYTES = 4096;
const TRUNCATION_SUFFIX = '...[truncated]';

interface RecordInput {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  diff?: string;
  outcome: Outcome;
  error?: string;
  duration_ms?: number;
}

export interface ActionLedger {
  record(entry: RecordInput): Promise<void>;
  sessionId: string;
  logPath: string;
}

export function createLedger(config: LedgerConfig): ActionLedger {
  const sessionId = config.sessionId ?? getSessionId();
  const maxBytes = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  function truncate(s: string): string {
    if (s.length <= maxBytes) return s;
    return s.slice(0, maxBytes) + TRUNCATION_SUFFIX;
  }

  return {
    sessionId,
    logPath: config.logPath,

    async record(input: RecordInput): Promise<void> {
      const entry: LedgerEntry = {
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        tool: input.tool,
        input: input.input,
        outcome: input.outcome,
        ...(input.output !== undefined && { output: truncate(input.output) }),
        ...(input.diff !== undefined && { diff: input.diff }),
        ...(input.error !== undefined && { error: input.error }),
        ...(input.duration_ms !== undefined && { duration_ms: input.duration_ms }),
      };
      await appendEntry(config.logPath, entry);
    },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add packages/action-ledger/src/index.ts packages/action-ledger/tests/action-ledger.test.ts
git commit -m "feat(action-ledger): ActionLedger class and createLedger factory"
```

---

### Task 6: Claude Code PostToolUse hook

**Files:**
- Create: `packages/action-ledger/hook/post-tool-use.ts`
- Create: `packages/action-ledger/hook/README.md`

**Step 1: Write the failing test**

Add to `tests/action-ledger.test.ts`:

```typescript
import { buildEntryFromHookPayload } from '../hook/post-tool-use';

describe('hook payload parser', () => {
  it('maps a Claude Code PostToolUse payload to a RecordInput', () => {
    const payload = {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_response: { output: 'file.txt', is_error: false },
    };
    const result = buildEntryFromHookPayload(payload);
    expect(result.tool).toBe('Bash');
    expect(result.outcome).toBe('success');
    expect(result.input).toEqual({ command: 'ls -la' });
  });

  it('sets outcome to error when is_error is true', () => {
    const payload = {
      tool_name: 'Bash',
      tool_input: { command: 'bad' },
      tool_response: { output: 'command not found', is_error: true },
    };
    const result = buildEntryFromHookPayload(payload);
    expect(result.outcome).toBe('error');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: FAIL — `buildEntryFromHookPayload` not found

**Step 3: Implement hook**

Create `packages/action-ledger/hook/post-tool-use.ts`:

```typescript
#!/usr/bin/env node
// Claude Code PostToolUse hook for @agent-ops/action-ledger
// Wire up in .claude/settings.json:
//   "hooks": { "PostToolUse": [{ "command": "node /path/to/post-tool-use.js" }] }
//
// Reads JSON payload from stdin, appends to ledger.

import { createLedger } from '../src/index';
import type { Outcome } from '../src/types';

interface HookPayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: { output?: string; is_error?: boolean; error?: string };
}

interface RecordInput {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  outcome: Outcome;
  error?: string;
}

export function buildEntryFromHookPayload(payload: HookPayload): RecordInput {
  const isError = payload.tool_response?.is_error === true;
  return {
    tool: payload.tool_name,
    input: payload.tool_input ?? {},
    output: payload.tool_response?.output,
    outcome: isError ? 'error' : 'success',
    ...(isError && payload.tool_response?.error && {
      error: payload.tool_response.error,
    }),
  };
}

// Only run as main script
if (require.main === module) {
  const logPath = process.env.AGENT_OPS_LOG_PATH ?? '.agent-ops/ledger.jsonl';
  const ledger = createLedger({ logPath });

  let raw = '';
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', async () => {
    try {
      const payload: HookPayload = JSON.parse(raw);
      await ledger.record(buildEntryFromHookPayload(payload));
    } catch {
      // Never crash the agent session
    }
    process.exit(0);
  });
}
```

Create `packages/action-ledger/hook/README.md`:

```markdown
# PostToolUse Hook

Wire action-ledger into any Claude Code session with zero code changes.

## Setup

Add to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "command": "AGENT_OPS_LOG_PATH=.agent-ops/ledger.jsonl node packages/action-ledger/hook/post-tool-use.js"
    }]
  }
}
```

The hook reads JSON from stdin (provided by Claude Code) and appends one JSONL line to the log file.

## Log Location

Default: `.agent-ops/ledger.jsonl` in your project root.
Override: set `AGENT_OPS_LOG_PATH` env var.
```

**Step 4: Run test to verify it passes**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add packages/action-ledger/hook/
git commit -m "feat(action-ledger): PostToolUse hook for Claude Code integration"
```

---

### Task 7: Final wiring — update package exports and README

**Files:**
- Modify: `packages/action-ledger/package.json`
- Modify: `packages/action-ledger/README.md`

**Step 1: Update package.json** to add `vitest` as a dev dependency and mark exports:

```json
{
  "name": "@agent-ops/action-ledger",
  "version": "0.1.0",
  "description": "Append-only JSONL log of every tool call, file diff, command, and outcome",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "keywords": ["agent-ops", "governance", "audit", "jsonl"],
  "license": "MIT",
  "devDependencies": {
    "typescript": "*",
    "vitest": "*"
  }
}
```

**Step 2: Run all tests one final time**

```bash
cd packages/action-ledger && npx vitest run
```
Expected: PASS — all suites green

**Step 3: Update README.md**

```markdown
# @agent-ops/action-ledger

> Append-only JSONL audit log for agent tool calls, file diffs, and command outcomes.

Part of the [agent-ops](../../README.md) monorepo — **Governance** category.

## Install

```bash
pnpm add @agent-ops/action-ledger
```

## Usage

```typescript
import { createLedger } from '@agent-ops/action-ledger';

const ledger = createLedger({ logPath: '.agent-ops/ledger.jsonl' });

await ledger.record({
  tool: 'Bash',
  input: { command: 'npm test' },
  output: '3 tests passed',
  outcome: 'success',
  duration_ms: 412,
});
```

### Log format (JSONL)

```json
{"timestamp":"2026-02-18T00:00:00.000Z","session_id":"uuid","tool":"Bash","input":{"command":"npm test"},"output":"3 tests passed","outcome":"success","duration_ms":412}
```

### Claude Code hook

See [`hook/README.md`](./hook/README.md) to wire this into any Claude Code session with zero code changes.

## Config

| Field | Type | Default | Description |
|---|---|---|---|
| `logPath` | `string` | required | Path to `.jsonl` output file |
| `maxOutputBytes` | `number` | `4096` | Truncate output beyond this size |
| `sessionId` | `string` | auto UUID | Override the session identifier |
```

**Step 4: Final commit**

```bash
git add packages/action-ledger/
git commit -m "feat(action-ledger): complete implementation with hook, tests, and docs"
```

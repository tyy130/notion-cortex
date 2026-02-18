import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LedgerEntry, LedgerConfig } from '../src/types';
import { generateSessionId, getSessionId } from '../src/session';
import { appendEntry } from '../src/writer';
import {
  createLedger,
  LEDGER_SCHEMA_VERSION,
  verifyLedgerEntrySignature,
  verifyLedgerFile,
} from '../src/index';

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

describe('writer', () => {
  it('appends valid JSONL lines to a file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-writer-'));
    const logPath = join(tempDir, 'ledger.jsonl');

    const entry: LedgerEntry = {
      timestamp: '2026-02-18T00:00:00.000Z',
      session_id: 'test-session',
      tool: 'Bash',
      input: { command: 'ls' },
      output: 'file.txt',
      outcome: 'success',
    };

    await appendEntry(logPath, entry);
    await appendEntry(logPath, { ...entry, tool: 'Read' });

    const contents = await readFile(logPath, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tool).toBe('Bash');
    expect(JSON.parse(lines[1]).tool).toBe('Read');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates parent directories when needed', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-nested-'));
    const logPath = join(tempDir, 'nested', 'ledger.jsonl');

    const entry: LedgerEntry = {
      timestamp: '2026-02-18T00:00:00.000Z',
      session_id: 'test-session',
      tool: 'Test',
      input: {},
      outcome: 'success',
    };

    await appendEntry(logPath, entry);
    const contents = await readFile(logPath, 'utf8');
    expect(JSON.parse(contents.trim()).tool).toBe('Test');

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe('ActionLedger', () => {
  it('records a tool call with timestamp and session id', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-record-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({ logPath, sessionId: 'session-123' });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'echo hello' },
      output: 'hello',
      outcome: 'success',
      duration_ms: 12,
    });

    const contents = await readFile(logPath, 'utf8');
    const entry = JSON.parse(contents.trim()) as LedgerEntry;
    expect(entry.tool).toBe('Bash');
    expect(entry.session_id).toBe('session-123');
    expect(entry.schema_version).toBe(LEDGER_SCHEMA_VERSION);
    expect(entry.timestamp).toBeDefined();
    expect(entry.duration_ms).toBe(12);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('records batches with recordMany in a single append sequence', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-batch-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({ logPath, sessionId: 'session-batch' });

    await ledger.recordMany([
      {
        tool: 'Bash',
        input: { command: 'echo one' },
        outcome: 'success',
        output: 'one',
      },
      {
        tool: 'Bash',
        input: { command: 'echo two' },
        outcome: 'success',
        output: 'two',
      },
    ]);

    const contents = await readFile(logPath, 'utf8');
    const [first, second] = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as LedgerEntry);

    expect(first.output).toBe('one');
    expect(second.output).toBe('two');
    expect(second.chain_prev_hash).toBe(first.chain_hash);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('truncates output using maxOutputBytes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-truncate-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({ logPath, maxOutputBytes: 10, sessionId: 'session-123' });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'cat big.txt' },
      output: 'a'.repeat(100),
      outcome: 'success',
    });

    const contents = await readFile(logPath, 'utf8');
    const entry = JSON.parse(contents.trim()) as LedgerEntry;
    expect(entry.output).toBe('aaaaaaaaaa...[truncated]');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('adds hash chain and signatures when signing is enabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-signing-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({
      logPath,
      sessionId: 'session-123',
      signingSecret: 'phase3-secret',
    });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'echo one' },
      outcome: 'success',
      output: 'one',
    });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'echo two' },
      outcome: 'success',
      output: 'two',
    });

    const contents = await readFile(logPath, 'utf8');
    const [first, second] = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as LedgerEntry);

    expect(first.chain_hash).toBeDefined();
    expect(first.chain_prev_hash).toBeUndefined();
    expect(second.chain_prev_hash).toBe(first.chain_hash);
    expect(second.chain_hash).toBeDefined();
    expect(first.signature).toBeDefined();
    expect(second.signature).toBeDefined();
    expect(verifyLedgerEntrySignature(first, 'phase3-secret')).toBe(true);
    expect(verifyLedgerEntrySignature(second, 'phase3-secret')).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('resumes chain across ledger instances for the same log path', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-resume-'));
    const logPath = join(tempDir, 'ledger.jsonl');

    const firstLedger = createLedger({ logPath, sessionId: 'session-1' });
    await firstLedger.record({
      tool: 'Bash',
      input: { command: 'echo first' },
      outcome: 'success',
    });

    const secondLedger = createLedger({ logPath, sessionId: 'session-2' });
    await secondLedger.record({
      tool: 'Bash',
      input: { command: 'echo second' },
      outcome: 'success',
    });

    const contents = await readFile(logPath, 'utf8');
    const [first, second] = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as LedgerEntry);

    expect(first.chain_hash).toBeDefined();
    expect(second.chain_prev_hash).toBe(first.chain_hash);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('supports signing key IDs and file-level verification', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-verify-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const keyId = 'signing-key-v1';
    const secret = 'phase4-secret';

    const ledger = createLedger({
      logPath,
      sessionId: 'session-verify',
      signingSecret: secret,
      signingKeyId: keyId,
    });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'echo secure' },
      outcome: 'success',
      output: 'secure',
    });

    const contents = await readFile(logPath, 'utf8');
    const entry = JSON.parse(contents.trim()) as LedgerEntry;
    expect(entry.key_id).toBe(keyId);
    expect(verifyLedgerEntrySignature(entry, secret)).toBe(true);

    const goodReport = await verifyLedgerFile(logPath, {
      signingSecretsByKeyId: { [keyId]: secret },
      requireSignatures: true,
    });
    expect(goodReport.valid).toBe(true);

    const tampered = { ...entry, output: 'tampered' };
    await writeFile(logPath, `${JSON.stringify(tampered)}\n`, 'utf8');

    const badReport = await verifyLedgerFile(logPath, {
      signingSecretsByKeyId: { [keyId]: secret },
      requireSignatures: true,
    });
    expect(badReport.valid).toBe(false);
    expect(badReport.errors.some((error) => error.includes('chain_hash mismatch'))).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('supports schema-version verification policies', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-schema-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({
      logPath,
      sessionId: 'session-schema',
    });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'echo schema' },
      outcome: 'success',
    });

    const supported = await verifyLedgerFile(logPath, {
      acceptedSchemaVersions: [LEDGER_SCHEMA_VERSION],
      allowMissingSchemaVersion: false,
    });
    expect(supported.valid).toBe(true);

    const unsupported = await verifyLedgerFile(logPath, {
      acceptedSchemaVersions: ['0.9.0'],
      allowMissingSchemaVersion: false,
    });
    expect(unsupported.valid).toBe(false);
    expect(
      unsupported.errors.some((error) => error.includes('unsupported schema_version')),
    ).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('applies backpressure when maxPendingWrites is exceeded', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-backpressure-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({
      logPath,
      sessionId: 'session-backpressure',
      maxPendingWrites: 0,
    });

    await expect(
      ledger.record({
        tool: 'Bash',
        input: { command: 'echo blocked' },
        outcome: 'success',
      }),
    ).rejects.toThrow('Write backpressure exceeded');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('blocks high-risk records until approval is present', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-approval-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({
      logPath,
      sessionId: 'session-123',
      approvalThreshold: 0.7,
    });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'rm -rf /tmp/demo' },
      outcome: 'success',
      risk_score: 0.95,
    });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'rm -rf /tmp/demo' },
      outcome: 'success',
      risk_score: 0.95,
      approved: true,
    });

    const contents = await readFile(logPath, 'utf8');
    const [blocked, approved] = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as LedgerEntry);

    expect(blocked.outcome).toBe('blocked');
    expect(blocked.approval_required).toBe(true);
    expect(blocked.error).toContain('Approval required');

    expect(approved.outcome).toBe('success');
    expect(approved.approval_required).toBe(true);
    expect(approved.approved).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('integrates with permission-gate decisions', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-permission-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({
      logPath,
      sessionId: 'session-permission',
      permissionGate: async () => ({
        allowed: false,
        reason: 'role guest cannot execute deploy',
        policy_id: 'policy-deny-deploy',
        role: 'guest',
        risk_score: 0.42,
      }),
    });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'deploy --prod' },
      outcome: 'success',
    });

    const contents = await readFile(logPath, 'utf8');
    const entry = JSON.parse(contents.trim()) as LedgerEntry;

    expect(entry.outcome).toBe('blocked');
    expect(entry.permission_allowed).toBe(false);
    expect(entry.permission_reason).toContain('cannot execute deploy');
    expect(entry.permission_policy_id).toBe('policy-deny-deploy');
    expect(entry.permission_role).toBe('guest');
    expect(entry.risk_score).toBe(0.42);
    expect(entry.approval_required).toBeUndefined();

    await rm(tempDir, { recursive: true, force: true });
  });

  it('integrates with approval-queue escalation and request tracking', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-approval-queue-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({
      logPath,
      sessionId: 'session-approval-queue',
      approvalThreshold: 0.7,
      permissionGate: () => ({
        allowed: true,
        role: 'operator',
        risk_score: 0.92,
      }),
      approvalQueue: async () => ({
        approved: false,
        request_id: 'apr-123',
        reason: 'manual approval required from on-call',
      }),
    });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'deploy --prod' },
      outcome: 'success',
    });

    const contents = await readFile(logPath, 'utf8');
    const entry = JSON.parse(contents.trim()) as LedgerEntry;

    expect(entry.outcome).toBe('blocked');
    expect(entry.permission_allowed).toBe(true);
    expect(entry.approval_required).toBe(true);
    expect(entry.approval_request_id).toBe('apr-123');
    expect(entry.approval_reason).toContain('manual approval required');
    expect(entry.error).toContain('manual approval required');

    await rm(tempDir, { recursive: true, force: true });
  });
});

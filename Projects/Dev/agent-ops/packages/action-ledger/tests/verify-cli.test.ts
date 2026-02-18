import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLedger, LEDGER_SCHEMA_VERSION } from '../src/index';
import { runVerifyLedgerCli } from '../src/cli/verify-ledger';

describe('verify-ledger CLI', () => {
  it('returns 0 for valid ledger and supports --json output', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-verify-cli-ok-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({ logPath, sessionId: 'session-cli-ok' });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'echo ok' },
      outcome: 'success',
    });

    const messages: string[] = [];
    const code = await runVerifyLedgerCli(
      [logPath, '--accept-schema', LEDGER_SCHEMA_VERSION, '--json'],
      {},
      {
        log: (message: string) => messages.push(message),
        error: (message: string) => messages.push(message),
      },
    );

    expect(code).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"valid":true');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns 1 for unsupported schema version policy', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'action-ledger-verify-cli-fail-'));
    const logPath = join(tempDir, 'ledger.jsonl');
    const ledger = createLedger({ logPath, sessionId: 'session-cli-fail' });

    await ledger.record({
      tool: 'Bash',
      input: { command: 'echo fail' },
      outcome: 'success',
    });

    const errors: string[] = [];
    const code = await runVerifyLedgerCli(
      [logPath, '--accept-schema', '0.0.1', '--disallow-missing-schema'],
      {},
      {
        log: (_message: string) => undefined,
        error: (message: string) => errors.push(message),
      },
    );

    expect(code).toBe(1);
    expect(errors[0]).toContain('unsupported schema_version');

    await rm(tempDir, { recursive: true, force: true });
  });
});

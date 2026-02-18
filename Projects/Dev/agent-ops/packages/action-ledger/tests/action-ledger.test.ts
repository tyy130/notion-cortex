import { describe, it, expect } from 'vitest';
import type { LedgerEntry, LedgerConfig } from '../src/types';
import { generateSessionId, getSessionId } from '../src/session';

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

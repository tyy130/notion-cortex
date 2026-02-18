import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../src/types';
import { classifyFailure, toDecisionCard, toTraceStep } from '../src/integrations';

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    schema_version: '1.0.0',
    timestamp: '2026-02-18T00:00:00.000Z',
    session_id: 'session-1',
    tool: 'Bash',
    input: { command: 'echo hello' },
    outcome: 'success',
    chain_hash: 'hash-1',
    ...overrides,
  };
}

describe('phase8 integration adapters', () => {
  it('maps a ledger entry to trace-step shape', () => {
    const entry = makeEntry({ output: 'hello', duration_ms: 10, diff: '--- a\n+++ b' });
    const trace = toTraceStep(entry);

    expect(trace.step).toBe('Bash:success');
    expect(trace.duration_ms).toBe(10);
    expect(trace.tool_calls[0].tool).toBe('Bash');
    expect(trace.tool_calls[0].output).toBe('hello');
    expect(trace.diff_summary).toContain('+++ b');
  });

  it('classifies permission and approval blocked outcomes', () => {
    const permissionBlocked = classifyFailure(
      makeEntry({
        outcome: 'blocked',
        permission_allowed: false,
        permission_reason: 'policy deny',
      }),
    );
    const approvalBlocked = classifyFailure(
      makeEntry({
        outcome: 'blocked',
        approval_required: true,
        approval_reason: 'waiting for reviewer',
      }),
    );

    expect(permissionBlocked.category).toBe('permission_blocked');
    expect(permissionBlocked.reason).toBe('policy deny');
    expect(approvalBlocked.category).toBe('approval_blocked');
    expect(approvalBlocked.reason).toBe('waiting for reviewer');
  });

  it('builds decision cards with best-available reason', () => {
    const card = toDecisionCard(
      makeEntry({
        outcome: 'blocked',
        approval_reason: 'manual approval required',
        risk_score: 0.91,
      }),
    );

    expect(card.title).toBe('Bash blocked');
    expect(card.why).toContain('manual approval required');
    expect(card.risk_score).toBe(0.91);
  });
});

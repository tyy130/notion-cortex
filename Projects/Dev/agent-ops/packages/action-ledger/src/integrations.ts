import type { LedgerEntry } from './types';

export interface TraceToolCall {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  outcome: LedgerEntry['outcome'];
  duration_ms?: number;
}

export interface TraceStep {
  step: string;
  duration_ms?: number;
  tool_calls: TraceToolCall[];
  diff_summary?: string;
}

export type FailureCategory =
  | 'success'
  | 'tool_error'
  | 'permission_blocked'
  | 'approval_blocked'
  | 'unknown';

export interface FailureTaxonomyRecord {
  category: FailureCategory;
  tool: string;
  reason?: string;
}

export interface DecisionCard {
  title: string;
  why: string;
  outcome: LedgerEntry['outcome'];
  risk_score?: number;
}

export function toTraceStep(entry: LedgerEntry): TraceStep {
  return {
    step: `${entry.tool}:${entry.outcome}`,
    ...(entry.duration_ms !== undefined && { duration_ms: entry.duration_ms }),
    tool_calls: [
      {
        tool: entry.tool,
        input: entry.input,
        ...(entry.output !== undefined && { output: entry.output }),
        outcome: entry.outcome,
        ...(entry.duration_ms !== undefined && { duration_ms: entry.duration_ms }),
      },
    ],
    ...(entry.diff !== undefined && { diff_summary: entry.diff }),
  };
}

export function classifyFailure(entry: LedgerEntry): FailureTaxonomyRecord {
  if (entry.outcome === 'success') {
    return { category: 'success', tool: entry.tool };
  }

  if (entry.outcome === 'error') {
    return { category: 'tool_error', tool: entry.tool, ...(entry.error && { reason: entry.error }) };
  }

  if (entry.outcome === 'blocked' && entry.permission_allowed === false) {
    return {
      category: 'permission_blocked',
      tool: entry.tool,
      ...(entry.permission_reason && { reason: entry.permission_reason }),
    };
  }

  if (entry.outcome === 'blocked' && entry.approval_required) {
    return {
      category: 'approval_blocked',
      tool: entry.tool,
      ...(entry.approval_reason && { reason: entry.approval_reason }),
    };
  }

  return {
    category: 'unknown',
    tool: entry.tool,
    ...(entry.error && { reason: entry.error }),
  };
}

export function toDecisionCard(entry: LedgerEntry): DecisionCard {
  const why =
    entry.permission_reason ??
    entry.approval_reason ??
    entry.error ??
    `Action recorded with outcome=${entry.outcome}`;

  return {
    title: `${entry.tool} ${entry.outcome}`,
    why,
    outcome: entry.outcome,
    ...(entry.risk_score !== undefined && { risk_score: entry.risk_score }),
  };
}

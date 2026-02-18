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

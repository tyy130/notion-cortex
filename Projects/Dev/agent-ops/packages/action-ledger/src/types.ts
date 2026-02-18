export type Outcome = 'success' | 'error' | 'blocked' | 'skipped';
export type HookSource = 'claude' | 'copilot' | 'gemini' | 'codex' | 'aider' | 'unknown';

export interface LedgerEntry {
  schema_version?: string;   // schema version for compatibility/migration checks
  timestamp: string;        // ISO 8601
  session_id: string;       // UUID per process
  tool: string;             // e.g. "Bash", "Edit", "Read"
  input: Record<string, unknown>;
  output?: string;          // truncated stdout/result
  diff?: string;            // unified diff for file edits
  outcome: Outcome;
  error?: string;           // error message if outcome === 'error'
  duration_ms?: number;     // wall time for the tool call
  hook_source?: HookSource; // source runtime for unified hook integrations
  risk_score?: number;      // optional risk score used for approval gating
  approved?: boolean;       // explicit approval status when applicable
  approval_required?: boolean; // indicates record was subject to approval gate
  chain_prev_hash?: string; // previous ledger hash for tamper-evident chaining
  chain_hash?: string;      // hash of current ledger entry payload
  signature?: string;       // optional HMAC signature for tamper evidence
  key_id?: string;          // signing key identifier for rotated keys
  permission_allowed?: boolean; // permission-gate result
  permission_reason?: string;   // permission-gate reason when provided
  permission_policy_id?: string; // matched permission policy identifier
  permission_role?: string;     // evaluated role context from permission-gate
  approval_request_id?: string; // approval-queue request identifier
  approval_reason?: string;     // approval queue reason or escalation note
}

export interface LedgerConfig {
  logPath: string;          // path to .jsonl file, e.g. ".agent-ops/ledger.jsonl"
  maxOutputBytes?: number;  // truncate output at this size (default: 4096)
  maxPendingWrites?: number; // backpressure cap for queued write operations
  sessionId?: string;       // override auto-generated UUID
  schemaVersion?: string;   // override emitted schema version for migration windows
  signingSecret?: string;   // optional HMAC secret for signing entries
  signingKeyId?: string;    // optional signing key ID written into each signed entry
  approvalThreshold?: number; // risk score threshold requiring explicit approval
  resumeChain?: boolean;    // resume chain from existing log (default: true)
}

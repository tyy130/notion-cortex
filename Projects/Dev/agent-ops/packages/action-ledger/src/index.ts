// @agent-ops/action-ledger
// Append-only JSONL log of every tool call, file diff, command, and outcome

export * from './types';
export { generateSessionId, getSessionId } from './session';
export { appendEntry, appendEntries } from './writer';
export { detectHookSource, normalizeHookPayload, parseHookSourceHint } from './hook';
export { toTraceStep, classifyFailure, toDecisionCard } from './integrations';

import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { getSessionId } from './session';
import { appendEntries } from './writer';
import type { HookSource, LedgerConfig, LedgerEntry, Outcome } from './types';

const DEFAULT_MAX_OUTPUT_BYTES = 4096;
const DEFAULT_MAX_PENDING_WRITES = 1024;
const TRUNCATION_SUFFIX = '...[truncated]';
export const LEDGER_SCHEMA_VERSION = '1.0.0';

export interface RecordInput {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  diff?: string;
  outcome: Outcome;
  error?: string;
  duration_ms?: number;
  hook_source?: HookSource;
  risk_score?: number;
  approved?: boolean;
}

export interface ActionLedger {
  sessionId: string;
  logPath: string;
  record(input: RecordInput): Promise<void>;
  recordMany(inputs: readonly RecordInput[]): Promise<void>;
}

export interface PermissionGateContext {
  tool: string;
  input: Record<string, unknown>;
  hook_source?: HookSource;
  risk_score?: number;
  approval_threshold?: number;
  session_id: string;
  log_path: string;
}

export interface PermissionGateDecision {
  allowed: boolean;
  reason?: string;
  policy_id?: string;
  role?: string;
  risk_score?: number;
}

export type PermissionGateHandler = (
  context: PermissionGateContext,
) => PermissionGateDecision | Promise<PermissionGateDecision>;

export interface ApprovalQueueContext {
  tool: string;
  input: Record<string, unknown>;
  hook_source?: HookSource;
  risk_score: number;
  approval_threshold: number;
  session_id: string;
  log_path: string;
}

export interface ApprovalQueueDecision {
  approved: boolean;
  request_id?: string;
  reason?: string;
}

export type ApprovalQueueHandler = (
  context: ApprovalQueueContext,
) => ApprovalQueueDecision | Promise<ApprovalQueueDecision>;

export interface ActionLedgerConfig extends LedgerConfig {
  permissionGate?: PermissionGateHandler;
  approvalQueue?: ApprovalQueueHandler;
}

export interface LedgerVerificationOptions {
  signingSecret?: string;
  signingSecretsByKeyId?: Record<string, string>;
  requireSignatures?: boolean;
  acceptedSchemaVersions?: readonly string[];
  allowMissingSchemaVersion?: boolean;
  maxErrors?: number;
}

export interface LedgerVerificationResult {
  valid: boolean;
  entries: number;
  errors: string[];
  lastChainHash?: string;
  schemaVersions?: string[];
  truncated?: boolean;
}

function truncateOutput(output: string, maxOutputBytes: number): string {
  if (output.length <= maxOutputBytes) {
    return output;
  }

  return output.slice(0, maxOutputBytes) + TRUNCATION_SUFFIX;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

function hashEntryPayload(entry: Omit<LedgerEntry, 'chain_hash' | 'signature'>): string {
  return createHash('sha256').update(stableStringify(entry), 'utf8').digest('hex');
}

function stripDerivedFields(
  entry: LedgerEntry,
): Omit<LedgerEntry, 'chain_hash' | 'signature'> {
  const { chain_hash: _chainHash, signature: _signature, ...rest } = entry;
  return rest;
}

function isLedgerEntryLike(value: unknown): value is LedgerEntry {
  return typeof value === 'object' && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export function verifyLedgerEntrySignature(
  entry: LedgerEntry,
  signingSecret: string,
): boolean {
  if (!entry.signature || !entry.chain_hash) {
    return false;
  }
  const expected = createHmac('sha256', signingSecret).update(entry.chain_hash, 'utf8').digest('hex');
  return expected === entry.signature;
}

function resolveSigningSecret(
  entry: LedgerEntry,
  options: LedgerVerificationOptions,
): string | undefined {
  if (entry.key_id && options.signingSecretsByKeyId && options.signingSecretsByKeyId[entry.key_id]) {
    return options.signingSecretsByKeyId[entry.key_id];
  }
  return options.signingSecret;
}

async function getLastHashFromLog(logPath: string): Promise<string | undefined> {
  let contents: string;
  try {
    contents = await readFile(logPath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  const lines = contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return undefined;
  }

  const lastLine = lines[lines.length - 1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse last ledger entry for resume: ${message}`);
  }

  if (!isLedgerEntryLike(parsed)) {
    throw new Error('Failed to resume chain: last ledger line is not a JSON object');
  }

  const entry = parsed as LedgerEntry;
  return entry.chain_hash ?? hashEntryPayload(stripDerivedFields(entry));
}

async function* readLedgerLines(logPath: string): AsyncGenerator<string> {
  const stream = createReadStream(logPath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const rawLine of reader) {
      const line = rawLine.trim();
      if (line.length > 0) {
        yield line;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}

export async function verifyLedgerFile(
  logPath: string,
  options: LedgerVerificationOptions = {},
): Promise<LedgerVerificationResult> {
  const errors: string[] = [];
  let previousHash: string | undefined;
  const schemaVersions = new Set<string>();
  const allowMissingSchemaVersion = options.allowMissingSchemaVersion !== false;
  const acceptedSchemaVersions = options.acceptedSchemaVersions;
  const maxErrors = options.maxErrors ?? Number.POSITIVE_INFINITY;
  let entries = 0;
  let truncated = false;

  let lineNumber = 0;
  for await (const line of readLedgerLines(logPath)) {
    lineNumber += 1;
    entries += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Line ${lineNumber}: invalid JSON (${message})`);
      if (errors.length >= maxErrors) {
        truncated = true;
        break;
      }
      continue;
    }

    if (!isLedgerEntryLike(parsed)) {
      errors.push(`Line ${lineNumber}: entry must be a JSON object`);
      if (errors.length >= maxErrors) {
        truncated = true;
        break;
      }
      continue;
    }

    const entry = parsed as LedgerEntry;
    if (entry.schema_version) {
      schemaVersions.add(entry.schema_version);
      if (
        acceptedSchemaVersions &&
        acceptedSchemaVersions.length > 0 &&
        !acceptedSchemaVersions.includes(entry.schema_version)
      ) {
        errors.push(
          `Line ${lineNumber}: unsupported schema_version ${entry.schema_version} (accepted: ${acceptedSchemaVersions.join(', ')})`,
        );
      }
    } else if (!allowMissingSchemaVersion) {
      errors.push(`Line ${lineNumber}: missing schema_version`);
    }

    const expectedHash = hashEntryPayload(stripDerivedFields(entry));

    if (!entry.chain_hash) {
      errors.push(`Line ${lineNumber}: missing chain_hash`);
    } else if (entry.chain_hash !== expectedHash) {
      errors.push(`Line ${lineNumber}: chain_hash mismatch`);
    }

    if (lineNumber > 1 && entry.chain_prev_hash !== previousHash) {
      errors.push(`Line ${lineNumber}: chain_prev_hash mismatch`);
    }

    if (entry.signature) {
      const secret = resolveSigningSecret(entry, options);
      if (!secret) {
        errors.push(`Line ${lineNumber}: signature present but no verification secret configured`);
      } else if (!verifyLedgerEntrySignature(entry, secret)) {
        errors.push(`Line ${lineNumber}: invalid signature`);
      }
    } else if (options.requireSignatures) {
      errors.push(`Line ${lineNumber}: missing signature`);
    }

    if (errors.length >= maxErrors) {
      truncated = true;
      break;
    }

    previousHash = entry.chain_hash ?? expectedHash;
  }

  return {
    valid: errors.length === 0,
    entries,
    errors,
    ...(previousHash !== undefined && { lastChainHash: previousHash }),
    ...(schemaVersions.size > 0 && { schemaVersions: Array.from(schemaVersions).sort() }),
    ...(truncated && { truncated: true }),
  };
}

export function createLedger(config: ActionLedgerConfig): ActionLedger {
  const sessionId = config.sessionId ?? getSessionId();
  const schemaVersion = config.schemaVersion ?? LEDGER_SCHEMA_VERSION;
  const maxOutputBytes = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxPendingWrites = config.maxPendingWrites ?? DEFAULT_MAX_PENDING_WRITES;
  const resumeChain = config.resumeChain !== false;
  let previousHash: string | undefined;
  let initialized = false;
  let writeQueue: Promise<void> = Promise.resolve();
  let pendingWrites = 0;

  async function ensureInitialized(): Promise<void> {
    if (initialized) {
      return;
    }
    if (resumeChain) {
      previousHash = await getLastHashFromLog(config.logPath);
    }
    initialized = true;
  }

  async function buildEntry(
    input: RecordInput,
    chainPrevHash: string | undefined,
  ): Promise<{ entry: LedgerEntry; chainHash: string }> {
    const permissionDecision = config.permissionGate
      ? await config.permissionGate({
          tool: input.tool,
          input: input.input,
          hook_source: input.hook_source,
          risk_score: input.risk_score,
          approval_threshold: config.approvalThreshold,
          session_id: sessionId,
          log_path: config.logPath,
        })
      : undefined;

    const permissionAllowed = permissionDecision?.allowed ?? true;
    const effectiveRiskScore = permissionDecision?.risk_score ?? input.risk_score;
    const approvalThreshold = config.approvalThreshold;
    const computedApprovalRequired =
      permissionAllowed &&
      approvalThreshold !== undefined &&
      effectiveRiskScore !== undefined &&
      effectiveRiskScore >= approvalThreshold;

    let approvalDecision: ApprovalQueueDecision | undefined;
    let effectiveApproved = input.approved;

    if (
      computedApprovalRequired &&
      effectiveApproved !== true &&
      config.approvalQueue &&
      effectiveRiskScore !== undefined &&
      approvalThreshold !== undefined
    ) {
      approvalDecision = await config.approvalQueue({
        tool: input.tool,
        input: input.input,
        hook_source: input.hook_source,
        risk_score: effectiveRiskScore,
        approval_threshold: approvalThreshold,
        session_id: sessionId,
        log_path: config.logPath,
      });
      if (approvalDecision.approved === true) {
        effectiveApproved = true;
      } else if (effectiveApproved === undefined) {
        effectiveApproved = false;
      }
    }

    const gatedOutcome: Outcome =
      !permissionAllowed || (computedApprovalRequired && effectiveApproved !== true)
        ? 'blocked'
        : input.outcome;
    const gatedError =
      !permissionAllowed
        ? permissionDecision?.reason ?? 'Blocked by permission-gate policy'
        : computedApprovalRequired && effectiveApproved !== true
          ? input.error ??
            approvalDecision?.reason ??
            `Approval required: risk_score ${effectiveRiskScore} >= threshold ${approvalThreshold}`
          : input.error;

    const entry: LedgerEntry = {
      schema_version: schemaVersion,
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      tool: input.tool,
      input: input.input,
      outcome: gatedOutcome,
      ...(input.output !== undefined && {
        output: truncateOutput(input.output, maxOutputBytes),
      }),
      ...(input.diff !== undefined && { diff: input.diff }),
      ...(gatedError !== undefined && { error: gatedError }),
      ...(input.duration_ms !== undefined && { duration_ms: input.duration_ms }),
      ...(input.hook_source !== undefined && { hook_source: input.hook_source }),
      ...(effectiveRiskScore !== undefined && { risk_score: effectiveRiskScore }),
      ...(effectiveApproved !== undefined && { approved: effectiveApproved }),
      ...(computedApprovalRequired && { approval_required: true }),
      ...(approvalDecision?.request_id !== undefined && {
        approval_request_id: approvalDecision.request_id,
      }),
      ...(approvalDecision?.reason !== undefined && { approval_reason: approvalDecision.reason }),
      ...(permissionDecision !== undefined && { permission_allowed: permissionAllowed }),
      ...(permissionDecision?.reason !== undefined && { permission_reason: permissionDecision.reason }),
      ...(permissionDecision?.policy_id !== undefined && {
        permission_policy_id: permissionDecision.policy_id,
      }),
      ...(permissionDecision?.role !== undefined && { permission_role: permissionDecision.role }),
      ...(chainPrevHash !== undefined && { chain_prev_hash: chainPrevHash }),
      ...(config.signingSecret && config.signingKeyId !== undefined && { key_id: config.signingKeyId }),
    };

    const chainHash = hashEntryPayload(entry);
    entry.chain_hash = chainHash;

    if (config.signingSecret) {
      entry.signature = createHmac('sha256', config.signingSecret)
        .update(chainHash, 'utf8')
        .digest('hex');
    }

    return { entry, chainHash };
  }

  async function enqueueWrite(operation: () => Promise<void>): Promise<void> {
    if (pendingWrites >= maxPendingWrites) {
      throw new Error(
        `Write backpressure exceeded: pending writes ${pendingWrites} >= maxPendingWrites ${maxPendingWrites}`,
      );
    }

    pendingWrites += 1;
    const run = async (): Promise<void> => {
      try {
        await ensureInitialized();
        await operation();
      } finally {
        pendingWrites -= 1;
      }
    };

    writeQueue = writeQueue.then(run, run);
    await writeQueue;
  }

  return {
    sessionId,
    logPath: config.logPath,
    async record(input: RecordInput): Promise<void> {
      await enqueueWrite(async () => {
        const { entry, chainHash } = await buildEntry(input, previousHash);
        await appendEntries(config.logPath, [entry]);
        previousHash = chainHash;
      });
    },
    async recordMany(inputs: readonly RecordInput[]): Promise<void> {
      if (inputs.length === 0) {
        return;
      }

      await enqueueWrite(async () => {
        const entries: LedgerEntry[] = [];
        let chainCursor = previousHash;

        for (const input of inputs) {
          const { entry, chainHash } = await buildEntry(input, chainCursor);
          entries.push(entry);
          chainCursor = chainHash;
        }

        await appendEntries(config.logPath, entries);
        previousHash = chainCursor;
      });
    },
  };
}

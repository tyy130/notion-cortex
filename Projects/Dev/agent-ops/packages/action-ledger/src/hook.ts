import type { RecordInput } from './index';
import type { HookSource, Outcome } from './types';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function getPathValue(source: JsonObject, path: readonly string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    const record = asJsonObject(current);
    if (!record || !(segment in record)) {
      return undefined;
    }
    current = record[segment];
  }
  return current;
}

function firstValue(source: JsonObject, paths: readonly (readonly string[])[]): unknown {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isJsonObject(value)) {
    if (typeof value.message === 'string') {
      return value.message;
    }
    return JSON.stringify(value);
  }
  return undefined;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function coerceRecord(value: unknown): Record<string, unknown> | undefined {
  if (isJsonObject(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = safelyParseJson(value);
    if (isJsonObject(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function safelyParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const TOOL_PATHS: readonly (readonly string[])[] = [
  ['tool_name'],
  ['toolName'],
  ['tool'],
  ['name'],
  ['action'],
  ['functionCall', 'name'],
  ['function_call', 'name'],
];

const INPUT_PATHS: readonly (readonly string[])[] = [
  ['tool_input'],
  ['toolInput'],
  ['input'],
  ['args'],
  ['arguments'],
  ['params'],
  ['functionCall', 'arguments'],
  ['function_call', 'arguments'],
];

const OUTPUT_PATHS: readonly (readonly string[])[] = [
  ['tool_response', 'output'],
  ['toolResponse', 'output'],
  ['tool_output'],
  ['toolOutput', 'output'],
  ['output'],
  ['result', 'output'],
  ['result'],
  ['response', 'output'],
  ['response'],
  ['stdout'],
];

const ERROR_PATHS: readonly (readonly string[])[] = [
  ['tool_response', 'error'],
  ['toolResponse', 'error'],
  ['toolOutput', 'error'],
  ['error'],
  ['stderr'],
  ['result', 'error'],
];

const IS_ERROR_PATHS: readonly (readonly string[])[] = [
  ['tool_response', 'is_error'],
  ['toolResponse', 'isError'],
  ['toolOutput', 'isError'],
  ['is_error'],
  ['isError'],
  ['failed'],
];

const BLOCKED_PATHS: readonly (readonly string[])[] = [
  ['blocked'],
  ['is_blocked'],
  ['isBlocked'],
];

const DIFF_PATHS: readonly (readonly string[])[] = [['diff'], ['patch'], ['tool_response', 'diff']];
const DURATION_PATHS: readonly (readonly string[])[] = [
  ['duration_ms'],
  ['durationMs'],
  ['elapsed_ms'],
  ['latency_ms'],
];
const EXIT_CODE_PATHS: readonly (readonly string[])[] = [['exit_code'], ['exitCode'], ['status']];
const COMMAND_PATHS: readonly (readonly string[])[] = [['command'], ['cmd'], ['tool_input', 'command']];

export function parseHookSourceHint(value: string | undefined): HookSource | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === 'claude' ||
    normalized === 'copilot' ||
    normalized === 'gemini' ||
    normalized === 'codex' ||
    normalized === 'aider' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }
  throw new Error(`Unsupported hook source hint: ${value}`);
}

export function detectHookSource(payload: unknown): HookSource {
  const root = asJsonObject(payload);
  if (!root) {
    return 'unknown';
  }

  if ('tool_name' in root || 'tool_response' in root) {
    return 'claude';
  }
  if ('toolName' in root || 'toolInput' in root || 'toolOutput' in root) {
    return 'copilot';
  }
  if ('functionCall' in root || 'function_call' in root || root.source === 'gemini') {
    return 'gemini';
  }
  if ('codex' in root || root.source === 'codex') {
    return 'codex';
  }
  if ('aider' in root || 'aider_version' in root || 'exit_code' in root) {
    return 'aider';
  }
  return 'unknown';
}

export function normalizeHookPayload(
  payload: unknown,
  sourceHint?: HookSource,
): RecordInput {
  const root = asJsonObject(payload);
  if (!root) {
    throw new Error('Hook payload must be a JSON object');
  }

  const hookSource = sourceHint ?? detectHookSource(root);
  const tool = coerceString(firstValue(root, TOOL_PATHS)) ?? 'UnknownTool';

  const inputFromPayload = coerceRecord(firstValue(root, INPUT_PATHS));
  const command = coerceString(firstValue(root, COMMAND_PATHS));
  const input = inputFromPayload ?? (command ? { command } : {});

  const output = coerceString(firstValue(root, OUTPUT_PATHS));
  const error = coerceString(firstValue(root, ERROR_PATHS));
  const diff = coerceString(firstValue(root, DIFF_PATHS));
  const duration_ms = coerceNumber(firstValue(root, DURATION_PATHS));
  const blocked = coerceBoolean(firstValue(root, BLOCKED_PATHS)) === true;
  const explicitError = coerceBoolean(firstValue(root, IS_ERROR_PATHS)) === true;
  const exitCode = coerceNumber(firstValue(root, EXIT_CODE_PATHS));
  const hasExitFailure = exitCode !== undefined && exitCode !== 0;

  const outcome: Outcome = blocked
    ? 'blocked'
    : explicitError || hasExitFailure || error !== undefined
      ? 'error'
      : 'success';

  return {
    tool,
    input,
    ...(output !== undefined && { output }),
    ...(diff !== undefined && { diff }),
    outcome,
    ...(error !== undefined && { error }),
    ...(duration_ms !== undefined && { duration_ms }),
    hook_source: hookSource,
  };
}

export async function readHookPayloadFromStdin(): Promise<unknown> {
  const raw = await new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });

  if (raw.trim() === '') {
    throw new Error('Hook payload stdin was empty');
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid hook payload JSON: ${message}`);
  }
}

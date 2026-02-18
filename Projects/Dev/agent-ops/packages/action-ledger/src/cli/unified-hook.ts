#!/usr/bin/env node

import { createLedger } from '../index';
import { normalizeHookPayload, parseHookSourceHint, readHookPayloadFromStdin } from '../hook';

function parseMaxOutputBytes(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid AGENT_OPS_MAX_OUTPUT_BYTES value: ${value}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const payload = await readHookPayloadFromStdin();
  const sourceHint = parseHookSourceHint(process.env.AGENT_OPS_HOOK_SOURCE);
  const normalized = normalizeHookPayload(payload, sourceHint);

  const ledger = createLedger({
    logPath: process.env.AGENT_OPS_LOG_PATH ?? '.agent-ops/ledger.jsonl',
    maxOutputBytes: parseMaxOutputBytes(process.env.AGENT_OPS_MAX_OUTPUT_BYTES),
  });

  await ledger.record(normalized);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[action-ledger-hook] ${message}`);
  process.exit(1);
});

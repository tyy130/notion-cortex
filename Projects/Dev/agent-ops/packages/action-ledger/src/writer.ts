import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LedgerEntry } from './types';

export async function appendEntry(logPath: string, entry: LedgerEntry): Promise<void> {
  await appendEntries(logPath, [entry]);
}

export async function appendEntries(logPath: string, entries: readonly LedgerEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await mkdir(dirname(logPath), { recursive: true });
  const payload = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  await appendFile(logPath, payload, 'utf8');
}

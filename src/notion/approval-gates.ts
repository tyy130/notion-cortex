import type { GateStatus } from '../types.js';
import { getNotionClient } from './client.js';
import { writeQueue, retryWithBackoff, sleep } from '../concurrency.js';
import { notionUrl } from './utils.js';

interface CreateGateParams {
  gateName: string;
  synthesisPageId: string;
}

interface GateResult {
  status: GateStatus;
  notes: string;
}

interface PollOptions {
  maxWaitMs?: number;
  initialDelayMs?: number;
}

export async function createApprovalGate(
  dbId: string,
  params: CreateGateParams,
): Promise<string> {
  const notion = getNotionClient();
  const synthesisUrl = notionUrl(params.synthesisPageId);
  const page = await writeQueue.enqueue(() =>
    retryWithBackoff(() =>
      notion.pages.create({
        parent: { database_id: dbId },
        properties: {
          title: { title: [{ text: { content: params.gateName } }] },
          status: { status: { name: 'Pending' } },
          notes: {
            rich_text: [
              { text: { content: 'Synthesis page: ' } },
              { text: { content: synthesisUrl, link: { url: synthesisUrl } } },
              { text: { content: '\n\nTo approve: open cortex-approval-gates, find this entry, and change Status → Approved (or Rejected with a note).' } },
            ],
          },
        },
      } as any),
    ),
  );
  return page.id;
}

// Polls approval gate with exponential backoff until Approved or Rejected.
// Prints console URL so user knows where to go.
export async function pollGateUntilResolved(
  gatePageId: string,
  options: PollOptions = {},
): Promise<GateResult> {
  const { maxWaitMs = 3_600_000, initialDelayMs = 2000 } = options;
  const notion = getNotionClient();
  const deadline = Date.now() + maxWaitMs;
  let delay = initialDelayMs;

  while (Date.now() < deadline) {
    const page = await notion.pages.retrieve({ page_id: gatePageId }) as any;
    const status = page.properties.status?.status?.name as GateStatus;
    const notes = (page.properties.notes?.rich_text ?? [])
      .map((s: any) => s.plain_text ?? '').join('');

    if (status === 'Approved' || status === 'Rejected') {
      return { status, notes };
    }

    await sleep(Math.min(delay, 60_000));
    delay = Math.min(delay * 2, 60_000);
  }

  throw new Error(`Approval gate timed out after ${maxWaitMs}ms`);
}

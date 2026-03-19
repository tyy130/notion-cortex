import type { AgentType } from '../types.js';
import { getNotionClient } from './client.js';
import { writeQueue, retryWithBackoff } from '../concurrency.js';

// Creates a new Working Memory page for an agent run.
// `label` is included in the title so judges/users can navigate the database
// and see which page belongs to which research angle.
// Returns the page ID — this is the agent's "outbox" for streaming reasoning.
export async function createWorkingMemoryPage(
  dbId: string,
  agentType: AgentType,
  taskId: string,
  label?: string,
): Promise<string> {
  const notion = getNotionClient();
  const title = label ? `${agentType}: ${label}` : `${agentType} — ${new Date().toISOString()}`;
  const page = await writeQueue.enqueue(() =>
    retryWithBackoff(() =>
      notion.pages.create({
        parent: { database_id: dbId },
        properties: {
          title: { title: [{ text: { content: title } }] },
          agent_type: { select: { name: agentType } },
          token_count: { number: 0 },
        },
      } as any),
    ),
  );
  return page.id;
}

// Updates the token_count property on a Working Memory page.
// Called after the stream buffer closes to record how much content was generated.
export async function updateTokenCount(pageId: string, charCount: number): Promise<void> {
  const notion = getNotionClient();
  await writeQueue.enqueue(() =>
    retryWithBackoff(() =>
      notion.pages.update({
        page_id: pageId,
        properties: { token_count: { number: charCount } },
      } as any),
    ),
  );
}

// Returns a flush function tied to a specific Working Memory page.
// Pass this to createStreamBuffer to wire streaming output into Notion.
export function createBlockFlusher(pageId: string) {
  const notion = getNotionClient();
  return async (text: string) => {
    await writeQueue.enqueue(() =>
      retryWithBackoff(() =>
        notion.blocks.children.append({
          block_id: pageId,
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
            },
          ],
        } as any),
      ),
    );
  };
}

// Reads all text content from a Working Memory page's blocks, paginating past
// Notion's 100-block-per-request limit. Joins all rich_text segments per block.
export async function readWorkingMemoryContent(pageId: string): Promise<string> {
  const notion = getNotionClient();
  const blocks: any[] = [];
  let cursor: string | undefined;

  do {
    const response: any = await notion.blocks.children.list({
      block_id: pageId,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as any);
    blocks.push(...response.results);
    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return blocks
    .map((block: any) => {
      const segments: any[] = block.paragraph?.rich_text ?? [];
      return segments.map((s: any) => s.plain_text ?? '').join('');
    })
    .filter(Boolean)
    .join('\n');
}

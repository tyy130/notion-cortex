import { getNotionClient } from './client.js';
import { writeQueue, retryWithBackoff } from '../concurrency.js';
import { markdownToNotionBlocks } from './markdown-blocks.js';

interface CreateOutputParams {
  title: string;
  topic: string;
}

export async function createOutputPage(
  dbId: string,
  params: CreateOutputParams,
  content: string,
): Promise<string> {
  const notion = getNotionClient();

  const page = await writeQueue.enqueue(() =>
    retryWithBackoff(() =>
      notion.pages.create({
        parent: { database_id: dbId },
        properties: {
          title: { title: [{ text: { content: params.title } }] },
          topic: { rich_text: [{ text: { content: params.topic } }] },
          created_at: { date: { start: new Date().toISOString() } },
        },
      } as any),
    ),
  );

  // Convert markdown to typed Notion blocks, then append in batches of 100
  // (Notion API limit per append call).
  const blocks = markdownToNotionBlocks(content);
  for (let start = 0; start < blocks.length; start += 100) {
    const batch = blocks.slice(start, start + 100);
    await writeQueue.enqueue(() =>
      retryWithBackoff(() =>
        notion.blocks.children.append({
          block_id: page.id,
          children: batch,
        } as any),
      ),
    );
  }

  return page.id;
}

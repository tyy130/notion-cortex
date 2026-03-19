import type { AgentContext } from '../types.js';
import { createBlockFlusher, readWorkingMemoryContent, updateTokenCount } from '../notion/working-memory.js';
import { getAllEntries } from '../notion/knowledge-graph.js';
import { createOutputPage } from '../notion/outputs.js';
import { claimTask, updateTaskStatus } from '../notion/task-bus.js';
import { createStreamBuffer } from '../streaming.js';
import { resolveModel, streamChat } from '../llm.js';

export async function runWriterAgent(
  ctx: AgentContext,
  synthesisPageId: string,
): Promise<string> {
  await claimTask(ctx.taskId, 'writer');

  const [synthesisContent, entries] = await Promise.all([
    readWorkingMemoryContent(synthesisPageId),
    getAllEntries(ctx.dbIds.knowledgeGraph),
  ]);

  const flushFn = createBlockFlusher(ctx.workingMemoryId);
  const flushIntervalMs = Number(process.env.CORTEX_STREAM_FLUSH_MS ?? 1000);
  const buffer = createStreamBuffer(flushFn, flushIntervalMs);

  try {
    const content = await streamChat(
      {
        model: resolveModel('capable'),
        maxTokens: 8192,
        messages: [
          {
            role: 'user',
            content: `You are an intelligence report writer. Produce a polished, final intelligence brief.

Topic: ${ctx.topic}

Synthesis:
${synthesisContent}

Knowledge Graph (${entries.length} entities):
${entries.slice(0, 30).map(e => `- ${e.entityName} (${e.entityType}): ${e.claim}`).join('\n')}

Write a publication-ready intelligence brief with:
- Clear headings using markdown
- An executive summary
- Detailed sections for each major area
- A "Key Entities" table
- Actionable conclusions

This will be displayed in Notion.`,
          },
        ],
      },
      (text) => buffer.push(text),
    );

    const charCount = await buffer.close();
    await updateTokenCount(ctx.workingMemoryId, charCount);

    const outputPageId = await createOutputPage(
      ctx.dbIds.outputs,
      { title: `Intelligence Brief: ${ctx.topic}`, topic: ctx.topic },
      content,
    );

    await updateTaskStatus(ctx.taskId, 'done');
    return outputPageId;
  } catch (err) {
    await updateTaskStatus(ctx.taskId, 'blocked');
    throw err;
  }
}

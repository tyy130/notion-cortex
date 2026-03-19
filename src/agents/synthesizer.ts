import type { AgentContext } from '../types.js';
import { createBlockFlusher, updateTokenCount } from '../notion/working-memory.js';
import { getAllEntries } from '../notion/knowledge-graph.js';
import { claimTask, updateTaskStatus } from '../notion/task-bus.js';
import { createStreamBuffer } from '../streaming.js';
import { resolveModel, streamChat } from '../llm.js';

// Returns the working memory page ID where synthesis was written
export async function runSynthesizerAgent(ctx: AgentContext): Promise<string> {
  await claimTask(ctx.taskId, 'synthesizer');

  const entries = await getAllEntries(ctx.dbIds.knowledgeGraph);
  const flushFn = createBlockFlusher(ctx.workingMemoryId);
  const flushIntervalMs = Number(process.env.CORTEX_STREAM_FLUSH_MS ?? 1000);
  const buffer = createStreamBuffer(flushFn, flushIntervalMs);

  try {
    await streamChat(
      {
        model: resolveModel('capable'),
        maxTokens: 8192,
        messages: [
          {
            role: 'user',
            content: `You are a synthesis analyst. Based on the knowledge graph entries below, write a comprehensive synthesis for the topic: "${ctx.topic}".

Knowledge graph (${entries.length} entries):
${entries.map(e => `[${e.entityType.toUpperCase()}] ${e.entityName}: ${e.claim} (confidence: ${e.confidence})`).join('\n')}

Write a structured synthesis with:
1. Executive Summary (3-5 sentences)
2. Key Players & Products
3. Major Trends
4. Market Gaps & Opportunities
5. Recommendations

Be specific and cite entities from the knowledge graph.`,
          },
        ],
      },
      (text) => buffer.push(text),
    );

    const charCount = await buffer.close();
    await updateTokenCount(ctx.workingMemoryId, charCount);
    await updateTaskStatus(ctx.taskId, 'done');
    return ctx.workingMemoryId;
  } catch (err) {
    await updateTaskStatus(ctx.taskId, 'blocked');
    throw err;
  }
}

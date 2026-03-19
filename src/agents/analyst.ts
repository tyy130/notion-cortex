import { z } from 'zod';
import { EntityTypeSchema, ConfidenceSchema } from '../types.js';
import type { AgentContext } from '../types.js';
import { createBlockFlusher, readWorkingMemoryContent, updateTokenCount } from '../notion/working-memory.js';
import { getAllEntries, createKnowledgeEntry } from '../notion/knowledge-graph.js';
import { claimTask, updateTaskStatus } from '../notion/task-bus.js';
import { createStreamBuffer } from '../streaming.js';
import { resolveModel, streamChat } from '../llm.js';

const EntityInputSchema = z.object({
  entityName: z.string().min(1).max(200),
  entityType: EntityTypeSchema,
  claim: z.string().min(1).max(500),
  confidence: ConfidenceSchema,
});

export async function runAnalystAgent(
  ctx: AgentContext,
  scoutPageIds: string[],
): Promise<void> {
  await claimTask(ctx.taskId, 'analyst');

  const scoutContent = await Promise.all(
    scoutPageIds.map(id => readWorkingMemoryContent(id)),
  );
  const existingEntries = await getAllEntries(ctx.dbIds.knowledgeGraph);

  const flushFn = createBlockFlusher(ctx.workingMemoryId);
  const flushIntervalMs = Number(process.env.CORTEX_STREAM_FLUSH_MS ?? 1000);
  const buffer = createStreamBuffer(flushFn, flushIntervalMs);

  try {
    const fullText = await streamChat(
      {
        model: resolveModel('capable'),
        maxTokens: 8192,
        messages: [
          {
            role: 'user',
            content: `You are an analyst. Review the Scout research below and enrich the knowledge graph.

Topic: ${ctx.topic}

Scout findings:
${scoutContent.map((c, i) => `--- Scout ${i + 1} ---\n${c}`).join('\n\n')}

Existing knowledge graph entries (${existingEntries.length} total):
${existingEntries.slice(0, 20).map(e => `- ${e.entityName}: ${e.claim}`).join('\n')}

Instructions:
1. Identify patterns, contradictions, and gaps across the Scout findings.
2. Stream your analysis.
3. At the END, output a JSON block with NEW entities not already in the knowledge graph:

\`\`\`json
{
  "newEntities": [
    {
      "entityName": "string",
      "entityType": "company|person|product|trend|concept",
      "claim": "string",
      "confidence": "high|medium|low"
    }
  ]
}
\`\`\``,
          },
        ],
      },
      (text) => buffer.push(text),
    );

    const charCount = await buffer.close();
    await updateTokenCount(ctx.workingMemoryId, charCount);

    const jsonMatch = fullText.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      console.warn(`Analyst (task ${ctx.taskId}): no JSON block found in response — skipping entity extraction`);
    } else {
      try {
        const { newEntities } = JSON.parse(jsonMatch[1]);
        for (const raw of newEntities ?? []) {
          const parsed = EntityInputSchema.safeParse(raw);
          if (!parsed.success) {
            console.warn(`Analyst (task ${ctx.taskId}): skipping invalid entity "${raw?.entityName}":`, parsed.error.flatten().fieldErrors);
            continue;
          }
          await createKnowledgeEntry(ctx.dbIds.knowledgeGraph, {
            ...parsed.data,
            createdByTaskId: ctx.taskId,
          });
        }
      } catch (err) {
        console.warn(`Analyst entity extraction failed (task ${ctx.taskId}):`, (err as Error).message);
      }
    }

    await updateTaskStatus(ctx.taskId, 'done');
  } catch (err) {
    await updateTaskStatus(ctx.taskId, 'blocked');
    throw err;
  }
}

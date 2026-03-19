import { z } from 'zod';
import { EntityTypeSchema, ConfidenceSchema } from '../types.js';
import type { AgentContext } from '../types.js';
import type { NotionMCPClient } from '../notion/mcp-client.js';
import { createBlockFlusher, updateTokenCount } from '../notion/working-memory.js';
import { createKnowledgeEntry } from '../notion/knowledge-graph.js';
import { claimTask, updateTaskStatus } from '../notion/task-bus.js';
import { createStreamBuffer } from '../streaming.js';
import { resolveModel, streamChat } from '../llm.js';

const MAX_TOKENS = 8192;

const EntityInputSchema = z.object({
  entityName: z.string().min(1).max(200),
  entityType: EntityTypeSchema,
  claim: z.string().min(1).max(500),
  confidence: ConfidenceSchema,
  source: z.string().url().optional().catch(undefined),
});

export async function runScoutAgent(
  ctx: AgentContext,
  mcp: NotionMCPClient,
): Promise<void> {
  await claimTask(ctx.taskId, 'scout');

  const flushFn = createBlockFlusher(ctx.workingMemoryId);
  const flushIntervalMs = Number(process.env.CORTEX_STREAM_FLUSH_MS ?? 1000);
  const buffer = createStreamBuffer(flushFn, flushIntervalMs);

  try {
    const fullText = await streamChat(
      {
        model: resolveModel('fast'),
        maxTokens: MAX_TOKENS,
        tools: mcp.tools,
        callTool: (name, input) => mcp.callTool(name, input),
        messages: [
          {
            role: 'user',
            content: `You are a research scout. Research the following sub-topic and extract structured findings.

Topic: ${ctx.topic}
Sub-topic to research: ${ctx.subTopic}

Instructions:
1. Think through what you know about this sub-topic. Stream your reasoning.
2. Use notion_search to check if relevant pages already exist in the workspace.
3. At the END of your response, output a JSON block with this exact structure:

\`\`\`json
{
  "entities": [
    {
      "entityName": "string",
      "entityType": "company|person|product|trend|concept",
      "claim": "one sentence factual claim",
      "confidence": "high|medium|low",
      "source": "https://example.com/relevant-page"
    }
  ]
}
\`\`\`

IMPORTANT: Every entity MUST include a "source" field with the most authoritative URL for the claim (official website, documentation page, Wikipedia article, research paper, news article, etc). Never omit the source field.

Be specific. Include 3–8 entities. Prioritize high-confidence claims.`,
          },
        ],
      },
      (text) => buffer.push(text),
    );

    const charCount = await buffer.close();
    await updateTokenCount(ctx.workingMemoryId, charCount);

    const jsonMatch = fullText.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      console.warn(`Scout (task ${ctx.taskId}): no JSON block found in response — skipping entity extraction`);
    } else {
      try {
        const { entities } = JSON.parse(jsonMatch[1]);
        for (const raw of entities ?? []) {
          const parsed = EntityInputSchema.safeParse(raw);
          if (!parsed.success) {
            console.warn(`Scout (task ${ctx.taskId}): skipping invalid entity "${raw?.entityName}":`, parsed.error.flatten().fieldErrors);
            continue;
          }
          await createKnowledgeEntry(ctx.dbIds.knowledgeGraph, {
            ...parsed.data,
            createdByTaskId: ctx.taskId,
          });
        }
      } catch (err) {
        console.warn(`Scout entity extraction failed (task ${ctx.taskId}):`, (err as Error).message);
      }
    }

    await updateTaskStatus(ctx.taskId, 'done');
  } catch (err) {
    await updateTaskStatus(ctx.taskId, 'blocked');
    throw err;
  }
}

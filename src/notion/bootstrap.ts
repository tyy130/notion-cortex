import type { NotionDbIds } from '../types.js';
import { getNotionClient } from './client.js';

const DB_NAMES = {
  taskBus: 'cortex-task-bus',
  workingMemory: 'cortex-working-memory',
  knowledgeGraph: 'cortex-knowledge-graph',
  approvalGates: 'cortex-approval-gates',
  outputs: 'cortex-outputs',
} as const;

// Creates all 5 Notion databases in the given parent page. Idempotent —
// if databases with the cortex- prefix already exist, reuses them.
export async function bootstrapWorkspace(
  parentPageId: string,
): Promise<NotionDbIds> {
  const notion = getNotionClient();

  // Paginate through ALL databases — Notion returns max 100 per page.
  const existing = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const response = await notion.search({
      filter: { value: 'database', property: 'object' },
      ...(cursor ? { start_cursor: cursor } : {}),
    } as any);
    for (const db of response.results) {
      if (db.object !== 'database') continue;
      // Skip archived/deleted databases — search still returns them.
      if ((db as any).archived) continue;
      // Only reuse databases that are direct children of our parent page,
      // so cortex-* names from other workspaces/projects don't collide.
      const parentId = (db as any).parent?.page_id?.replace(/-/g, '');
      const targetId = parentPageId.replace(/-/g, '');
      if (parentId !== targetId) continue;
      const title = (db as any).title?.[0]?.plain_text ?? '';
      for (const [key, name] of Object.entries(DB_NAMES)) {
        if (title === name) existing.set(key, db.id);
      }
    }
    cursor = (response as any).next_cursor ?? undefined;
  } while (cursor);

  async function getOrCreate(
    key: keyof typeof DB_NAMES,
    properties: Record<string, unknown>,
  ): Promise<string> {
    if (existing.has(key)) return existing.get(key)!;
    const db = await notion.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: DB_NAMES[key] } }],
      properties,
    } as any);
    return db.id;
  }

  const taskBus = await getOrCreate('taskBus', {
    title: { title: {} },
    status: { select: { options: [{ name: 'pending' }, { name: 'active' }, { name: 'done' }, { name: 'blocked' }] } },
    assigned_agent: { select: { options: [{ name: 'scout' }, { name: 'analyst' }, { name: 'synthesizer' }, { name: 'writer' }] } },
    priority: { number: {} },
    created_by: { select: { options: [{ name: 'orchestrator' }, { name: 'scout' }, { name: 'analyst' }] } },
  });

  const workingMemory = await getOrCreate('workingMemory', {
    title: { title: {} },
    agent_type: { select: { options: [{ name: 'scout' }, { name: 'analyst' }, { name: 'synthesizer' }, { name: 'writer' }] } },
    token_count: { number: {} },
  });

  const knowledgeGraph = await getOrCreate('knowledgeGraph', {
    entity_name: { title: {} },
    entity_type: { select: { options: [{ name: 'company' }, { name: 'person' }, { name: 'product' }, { name: 'trend' }, { name: 'concept' }] } },
    claim: { rich_text: {} },
    confidence: { select: { options: [{ name: 'high' }, { name: 'medium' }, { name: 'low' }] } },
    source: { url: {} },
    created_by_task_id: { rich_text: {} },
  });

  // Ensure schema properties exist on pre-existing databases.
  // databases.update is additive — safe to call on every run (idempotent).
  try {
    await notion.databases.update({
      database_id: knowledgeGraph,
      properties: {
        related_entities: {
          relation: {
            database_id: knowledgeGraph,
            type: 'single_property',
            single_property: {},
          },
        },
        created_by_task_id: { rich_text: {} },
      },
    } as any);
  } catch { /* properties already exist with identical config — skip */ }

  const approvalGates = await getOrCreate('approvalGates', {
    title: { title: {} },
    status: { status: { options: [{ name: 'Pending', color: 'yellow' }, { name: 'Approved', color: 'green' }, { name: 'Rejected', color: 'red' }] } },
    notes: { rich_text: {} },
  });

  const outputs = await getOrCreate('outputs', {
    title: { title: {} },
    topic: { rich_text: {} },
    created_at: { date: {} },
  });

  return { taskBus, workingMemory, knowledgeGraph, approvalGates, outputs };
}

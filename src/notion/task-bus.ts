import type { Task, TaskStatus, AgentType } from '../types.js';
import { getNotionClient } from './client.js';
import { writeQueue, retryWithBackoff } from '../concurrency.js';

interface CreateTaskParams {
  title: string;
  createdBy: 'orchestrator' | 'scout' | 'analyst';
  priority?: number;
}

export async function createTask(
  dbId: string,
  params: CreateTaskParams,
): Promise<string> {
  const notion = getNotionClient();
  const page = await writeQueue.enqueue(() =>
    retryWithBackoff(() =>
      notion.pages.create({
        parent: { database_id: dbId },
        properties: {
          title: { title: [{ text: { content: params.title } }] },
          status: { select: { name: 'pending' } },
          priority: { number: params.priority ?? 0 },
          created_by: { select: { name: params.createdBy } },
        },
      } as any),
    ),
  );
  return page.id;
}

export async function claimTask(
  taskId: string,
  agentType: AgentType,
): Promise<void> {
  const notion = getNotionClient();
  await writeQueue.enqueue(() =>
    retryWithBackoff(() =>
      notion.pages.update({
        page_id: taskId,
        properties: {
          status: { select: { name: 'active' } },
          assigned_agent: { select: { name: agentType } },
        },
      } as any),
    ),
  );
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  const notion = getNotionClient();
  await writeQueue.enqueue(() =>
    retryWithBackoff(() =>
      notion.pages.update({
        page_id: taskId,
        properties: { status: { select: { name: status } } },
      } as any),
    ),
  );
}

export async function listTasksByStatus(
  dbId: string,
  status: TaskStatus,
): Promise<Task[]> {
  const notion = getNotionClient();
  const { results } = await notion.databases.query({
    database_id: dbId,
    filter: { property: 'status', select: { equals: status } },
  } as any);

  return results.map((page: any) => ({
    id: page.id,
    title: page.properties.title?.title?.[0]?.plain_text ?? '',
    status: page.properties.status?.select?.name ?? 'pending',
    assignedAgent: page.properties.assigned_agent?.select?.name ?? undefined,
    priority: page.properties.priority?.number ?? 0,
    createdBy: page.properties.created_by?.select?.name ?? 'orchestrator',
  }));
}

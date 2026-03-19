// tests/notion/task-bus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/notion/client.js', () => ({ getNotionClient: vi.fn() }));
vi.mock('../../src/concurrency.js', () => ({
  writeQueue: { enqueue: (fn: any) => fn() },
  createWriteQueue: () => ({ enqueue: (fn: any) => fn() }),
  retryWithBackoff: (fn: any) => fn(),
}));

import { getNotionClient } from '../../src/notion/client.js';
import { createTask, claimTask, updateTaskStatus, listTasksByStatus } from '../../src/notion/task-bus.js';

const mockNotion = {
  pages: { create: vi.fn(), update: vi.fn() },
  databases: { query: vi.fn() },
};

beforeEach(() => {
  vi.mocked(getNotionClient).mockReturnValue(mockNotion as any);
  vi.clearAllMocks();
});

describe('createTask', () => {
  it('creates a page in the task bus database', async () => {
    mockNotion.pages.create.mockResolvedValue({ id: 'task-1' });

    const id = await createTask('db-123', {
      title: 'Research Cursor',
      createdBy: 'orchestrator',
      priority: 1,
    });

    expect(mockNotion.pages.create).toHaveBeenCalledOnce();
    expect(id).toBe('task-1');
  });
});

describe('claimTask', () => {
  it('updates task status to active and sets assigned agent', async () => {
    mockNotion.pages.update.mockResolvedValue({ id: 'task-1' });

    await claimTask('task-1', 'scout');

    expect(mockNotion.pages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'task-1',
        properties: expect.objectContaining({
          status: expect.objectContaining({ select: { name: 'active' } }),
        }),
      }),
    );
  });
});

describe('listTasksByStatus', () => {
  it('queries the database with a status filter', async () => {
    mockNotion.databases.query.mockResolvedValue({
      results: [
        {
          id: 'task-1',
          properties: {
            title: { title: [{ plain_text: 'Research Cursor' }] },
            status: { select: { name: 'pending' } },
            priority: { number: 1 },
            created_by: { select: { name: 'orchestrator' } },
            assigned_agent: { select: null },
          },
        },
      ],
    });

    const tasks = await listTasksByStatus('db-123', 'pending');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Research Cursor');
    expect(tasks[0].status).toBe('pending');
  });
});

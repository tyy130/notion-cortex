// tests/notion/bootstrap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NotionDbIds } from '../../src/types.js';

vi.mock('../../src/notion/client.js', () => ({
  getNotionClient: vi.fn(),
}));

import { getNotionClient } from '../../src/notion/client.js';
import { bootstrapWorkspace } from '../../src/notion/bootstrap.js';

const mockNotion = {
  search: vi.fn(),
  databases: {
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
};

beforeEach(() => {
  vi.mocked(getNotionClient).mockReturnValue(mockNotion as any);
  vi.clearAllMocks();
});

describe('bootstrapWorkspace', () => {
  it('creates all 5 databases when none exist', async () => {
    mockNotion.search.mockResolvedValue({ results: [] });
    mockNotion.databases.create.mockImplementation(async (params: any) => ({
      id: `db-${params.title[0].text.content}`,
    }));

    const ids = await bootstrapWorkspace('page-123');

    expect(mockNotion.databases.create).toHaveBeenCalledTimes(5);
    expect(ids).toHaveProperty('taskBus');
    expect(ids).toHaveProperty('workingMemory');
    expect(ids).toHaveProperty('knowledgeGraph');
    expect(ids).toHaveProperty('approvalGates');
    expect(ids).toHaveProperty('outputs');
  });

  it('adds self-referential relation property to the knowledge graph', async () => {
    mockNotion.search.mockResolvedValue({ results: [] });
    mockNotion.databases.create.mockImplementation(async (params: any) => ({
      id: `db-${params.title[0].text.content}`,
    }));

    await bootstrapWorkspace('page-123');

    expect(mockNotion.databases.update).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          related_entities: expect.objectContaining({
            relation: expect.objectContaining({ database_id: expect.any(String) }),
          }),
        }),
      }),
    );
  });

  it('reuses existing databases (idempotent)', async () => {
    const parent = { page_id: 'page-123' };
    mockNotion.search.mockResolvedValue({
      results: [
        { id: 'existing-task-bus', title: [{ plain_text: 'cortex-task-bus' }], object: 'database', parent },
        { id: 'existing-wm', title: [{ plain_text: 'cortex-working-memory' }], object: 'database', parent },
        { id: 'existing-kg', title: [{ plain_text: 'cortex-knowledge-graph' }], object: 'database', parent },
        { id: 'existing-ag', title: [{ plain_text: 'cortex-approval-gates' }], object: 'database', parent },
        { id: 'existing-out', title: [{ plain_text: 'cortex-outputs' }], object: 'database', parent },
      ],
      next_cursor: null,
    });

    const ids = await bootstrapWorkspace('page-123');

    expect(mockNotion.databases.create).not.toHaveBeenCalled();
    expect(ids.taskBus).toBe('existing-task-bus');
  });

  it('follows pagination cursor to find existing databases', async () => {
    const parent = { page_id: 'page-123' };
    mockNotion.search
      .mockResolvedValueOnce({ results: [], next_cursor: 'cursor-abc' })
      .mockResolvedValueOnce({
        results: [
          { id: 'paginated-task-bus', title: [{ plain_text: 'cortex-task-bus' }], object: 'database', parent },
          { id: 'paginated-wm', title: [{ plain_text: 'cortex-working-memory' }], object: 'database', parent },
          { id: 'paginated-kg', title: [{ plain_text: 'cortex-knowledge-graph' }], object: 'database', parent },
          { id: 'paginated-ag', title: [{ plain_text: 'cortex-approval-gates' }], object: 'database', parent },
          { id: 'paginated-out', title: [{ plain_text: 'cortex-outputs' }], object: 'database', parent },
        ],
        next_cursor: null,
      });

    const ids = await bootstrapWorkspace('page-123');

    expect(mockNotion.search).toHaveBeenCalledTimes(2);
    expect(mockNotion.databases.create).not.toHaveBeenCalled();
    expect(ids.taskBus).toBe('paginated-task-bus');
  });
});

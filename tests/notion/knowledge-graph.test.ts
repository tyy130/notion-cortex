// tests/notion/knowledge-graph.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/notion/client.js', () => ({ getNotionClient: vi.fn() }));
vi.mock('../../src/concurrency.js', () => ({
  writeQueue: { enqueue: (fn: any) => fn() },
  createWriteQueue: () => ({ enqueue: (fn: any) => fn() }),
  retryWithBackoff: (fn: any) => fn(),
}));

import { getNotionClient } from '../../src/notion/client.js';
import { createKnowledgeEntry, queryEntitiesByType, computeAndStoreRelations } from '../../src/notion/knowledge-graph.js';

const mockNotion = {
  pages: { create: vi.fn(), update: vi.fn() },
  databases: { query: vi.fn() },
};

beforeEach(() => {
  vi.mocked(getNotionClient).mockReturnValue(mockNotion as any);
  vi.clearAllMocks();
});

describe('createKnowledgeEntry', () => {
  it('creates a database page with entity properties', async () => {
    // First call: upsert check returns empty (no duplicate)
    mockNotion.databases.query.mockResolvedValueOnce({ results: [] });
    mockNotion.pages.create.mockResolvedValue({ id: 'entry-1' });

    const id = await createKnowledgeEntry('db-kg', {
      entityName: 'Cursor',
      entityType: 'product',
      claim: 'AI-first code editor with ~40% market share among devs',
      confidence: 'high',
      createdByTaskId: 'task-1',
    });

    expect(id).toBe('entry-1');
    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { database_id: 'db-kg' },
      }),
    );
  });

  it('returns existing id without creating when duplicate entityName+entityType exists', async () => {
    mockNotion.databases.query.mockResolvedValueOnce({ results: [{ id: 'existing-entry' }] });

    const id = await createKnowledgeEntry('db-kg', {
      entityName: 'Cursor',
      entityType: 'product',
      claim: 'Another claim',
      confidence: 'medium',
      createdByTaskId: 'task-2',
    });

    expect(id).toBe('existing-entry');
    expect(mockNotion.pages.create).not.toHaveBeenCalled();
  });
});

describe('computeAndStoreRelations', () => {
  it('links entities whose names appear in each other\'s claims', async () => {
    mockNotion.pages.update.mockResolvedValue({});
    // Two entries: Cursor appears in GitHub Copilot's claim, so they should be linked
    const entries = [
      { id: 'page-cursor', properties: { entity_name: { title: [{ plain_text: 'Cursor' }] }, entity_type: { select: { name: 'product' } }, claim: { rich_text: [{ plain_text: 'AI-first code editor' }] }, confidence: { select: { name: 'high' } }, source: { url: null }, related_entities: { relation: [] } } },
      { id: 'page-copilot', properties: { entity_name: { title: [{ plain_text: 'GitHub Copilot' }] }, entity_type: { select: { name: 'product' } }, claim: { rich_text: [{ plain_text: 'Competes directly with Cursor in the AI editor market' }] }, confidence: { select: { name: 'high' } }, source: { url: null }, related_entities: { relation: [] } } },
    ];
    mockNotion.databases.query.mockResolvedValue({ results: entries });

    await computeAndStoreRelations('db-kg');

    // GitHub Copilot's claim mentions "Cursor" — should be linked
    expect(mockNotion.pages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'page-copilot',
        properties: expect.objectContaining({
          related_entities: { relation: [{ id: 'page-cursor' }] },
        }),
      }),
    );
  });

  it('skips relation pass when fewer than 2 entries exist', async () => {
    mockNotion.databases.query.mockResolvedValue({ results: [] });
    await computeAndStoreRelations('db-kg');
    expect(mockNotion.pages.update).not.toHaveBeenCalled();
  });
});

describe('queryEntitiesByType', () => {
  it('filters by entity_type and returns entries', async () => {
    mockNotion.databases.query.mockResolvedValue({
      results: [{
        id: 'entry-1',
        properties: {
          entity_name: { title: [{ plain_text: 'Cursor' }] },
          entity_type: { select: { name: 'product' } },
          claim: { rich_text: [{ plain_text: 'AI editor' }] },
          confidence: { select: { name: 'high' } },
          source: { url: null },
        },
      }],
    });

    const entries = await queryEntitiesByType('db-kg', 'product');
    expect(entries).toHaveLength(1);
    expect(entries[0].entityName).toBe('Cursor');
  });
});

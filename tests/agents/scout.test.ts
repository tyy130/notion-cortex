// tests/agents/scout.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/notion/working-memory.js', () => ({
  createBlockFlusher: vi.fn().mockReturnValue(vi.fn()),
  updateTokenCount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/notion/knowledge-graph.js', () => ({
  createKnowledgeEntry: vi.fn().mockResolvedValue('entry-1'),
}));
vi.mock('../../src/notion/task-bus.js', () => ({
  claimTask: vi.fn(),
  updateTaskStatus: vi.fn(),
}));
vi.mock('../../src/streaming.js', () => ({
  createStreamBuffer: vi.fn().mockReturnValue({
    push: vi.fn(),
    close: vi.fn().mockResolvedValue(42),
  }),
}));

// Mock the LLM abstraction — returns JSON-fenced entity block
vi.mock('../../src/llm.js', () => ({
  resolveModel: vi.fn().mockReturnValue('test-model'),
  streamChat: vi.fn().mockImplementation(async (_params: unknown, onChunk: (t: string) => void) => {
    const text =
      '```json\n' +
      JSON.stringify({
        entities: [
          {
            entityName: 'Cursor',
            entityType: 'product',
            claim: 'AI-first code editor',
            confidence: 'high',
          },
        ],
      }) +
      '\n```';
    onChunk(text);
    return text;
  }),
}));

import { runScoutAgent } from '../../src/agents/scout.js';
import { createKnowledgeEntry } from '../../src/notion/knowledge-graph.js';

const ctx = {
  taskId: 'task-1',
  workingMemoryId: 'wm-1',
  topic: 'AI coding assistants',
  subTopic: 'Cursor vs GitHub Copilot',
  dbIds: {
    taskBus: 'db-tasks',
    workingMemory: 'db-wm',
    knowledgeGraph: 'db-kg',
    approvalGates: 'db-gates',
    outputs: 'db-out',
  },
};

describe('runScoutAgent', () => {
  it('claims task, runs, and marks done', async () => {
    const { claimTask, updateTaskStatus } = await import('../../src/notion/task-bus.js');

    await runScoutAgent(ctx, { tools: [], callTool: vi.fn(), close: vi.fn() });

    expect(claimTask).toHaveBeenCalledWith('task-1', 'scout');
    expect(updateTaskStatus).toHaveBeenCalledWith('task-1', 'done');
  });

  it('writes extracted entities to knowledge graph', async () => {
    await runScoutAgent({ ...ctx, subTopic: 'Cursor' }, { tools: [], callTool: vi.fn(), close: vi.fn() });

    expect(createKnowledgeEntry).toHaveBeenCalledWith(
      'db-kg',
      expect.objectContaining({ entityName: 'Cursor' }),
    );
  });
});

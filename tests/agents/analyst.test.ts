// tests/agents/analyst.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/notion/working-memory.js', () => ({
  createBlockFlusher: vi.fn().mockReturnValue(vi.fn()),
  readWorkingMemoryContent: vi.fn().mockResolvedValue('Scout found: Cursor is popular'),
  updateTokenCount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/notion/knowledge-graph.js', () => ({
  getAllEntries: vi.fn().mockResolvedValue([
    { entityName: 'Cursor', entityType: 'product', claim: 'AI-first editor', confidence: 'high', id: 'e-1', relatedEntityIds: [], createdByTaskId: 't-1' },
  ]),
  createKnowledgeEntry: vi.fn().mockResolvedValue('entry-2'),
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
vi.mock('../../src/llm.js', () => ({
  resolveModel: vi.fn().mockReturnValue('test-model'),
  streamChat: vi.fn().mockImplementation(async (_params: unknown, onChunk: (t: string) => void) => {
    const text =
      '```json\n' +
      JSON.stringify({
        newEntities: [
          {
            entityName: 'GitHub Copilot',
            entityType: 'product',
            claim: 'AI pair programmer by GitHub',
            confidence: 'high',
          },
        ],
      }) +
      '\n```';
    onChunk(text);
    return text;
  }),
}));

import { runAnalystAgent } from '../../src/agents/analyst.js';
import { createKnowledgeEntry } from '../../src/notion/knowledge-graph.js';
import { claimTask, updateTaskStatus } from '../../src/notion/task-bus.js';

const ctx = {
  taskId: 'task-analyst',
  workingMemoryId: 'wm-analyst',
  topic: 'AI coding assistants',
  subTopic: 'AI coding assistants',
  dbIds: {
    taskBus: 'db-tasks',
    workingMemory: 'db-wm',
    knowledgeGraph: 'db-kg',
    approvalGates: 'db-gates',
    outputs: 'db-out',
  },
};

describe('runAnalystAgent', () => {
  it('claims task and marks done', async () => {
    await runAnalystAgent(ctx, ['wm-scout-1']);
    expect(claimTask).toHaveBeenCalledWith('task-analyst', 'analyst');
    expect(updateTaskStatus).toHaveBeenCalledWith('task-analyst', 'done');
  });

  it('writes new entities to knowledge graph', async () => {
    await runAnalystAgent(ctx, ['wm-scout-1']);
    expect(createKnowledgeEntry).toHaveBeenCalledWith(
      'db-kg',
      expect.objectContaining({ entityName: 'GitHub Copilot' }),
    );
  });

  it('marks task blocked and rethrows on LLM error', async () => {
    const { streamChat } = await import('../../src/llm.js');
    vi.mocked(streamChat).mockRejectedValueOnce(new Error('LLM unavailable'));

    await expect(runAnalystAgent(ctx, ['wm-scout-1'])).rejects.toThrow('LLM unavailable');
    expect(updateTaskStatus).toHaveBeenCalledWith('task-analyst', 'blocked');
  });
});

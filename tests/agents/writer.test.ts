// tests/agents/writer.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/notion/working-memory.js', () => ({
  createBlockFlusher: vi.fn().mockReturnValue(vi.fn()),
  readWorkingMemoryContent: vi.fn().mockResolvedValue('## Executive Summary\nCursor dominates.'),
  updateTokenCount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/notion/knowledge-graph.js', () => ({
  getAllEntries: vi.fn().mockResolvedValue([
    { entityName: 'Cursor', entityType: 'product', claim: 'AI-first editor', confidence: 'high', id: 'e-1', relatedEntityIds: [], createdByTaskId: 't-1' },
  ]),
}));
vi.mock('../../src/notion/outputs.js', () => ({
  createOutputPage: vi.fn().mockResolvedValue('output-page-1'),
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
    const text = '# Intelligence Brief\n## Executive Summary\nCursor is the leader.';
    onChunk(text);
    return text;
  }),
}));

import { runWriterAgent } from '../../src/agents/writer.js';
import { createOutputPage } from '../../src/notion/outputs.js';
import { claimTask, updateTaskStatus } from '../../src/notion/task-bus.js';

const ctx = {
  taskId: 'task-writer',
  workingMemoryId: 'wm-writer',
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

describe('runWriterAgent', () => {
  it('claims task, creates output page, marks done, returns output page id', async () => {
    const outputId = await runWriterAgent(ctx, 'synth-page-1');
    expect(claimTask).toHaveBeenCalledWith('task-writer', 'writer');
    expect(createOutputPage).toHaveBeenCalledWith(
      'db-out',
      expect.objectContaining({ topic: 'AI coding assistants' }),
      expect.any(String),
    );
    expect(updateTaskStatus).toHaveBeenCalledWith('task-writer', 'done');
    expect(outputId).toBe('output-page-1');
  });

  it('streams to working memory during generation', async () => {
    const { createStreamBuffer } = await import('../../src/streaming.js');
    const mockPush = vi.fn();
    vi.mocked(createStreamBuffer).mockReturnValueOnce({
      push: mockPush,
      close: vi.fn().mockResolvedValue(42),
    });

    await runWriterAgent(ctx, 'synth-page-1');
    expect(mockPush).toHaveBeenCalled();
  });

  it('marks task blocked and rethrows on LLM error', async () => {
    const { streamChat } = await import('../../src/llm.js');
    vi.mocked(streamChat).mockRejectedValueOnce(new Error('LLM down'));

    await expect(runWriterAgent(ctx, 'synth-page-1')).rejects.toThrow('LLM down');
    expect(updateTaskStatus).toHaveBeenCalledWith('task-writer', 'blocked');
  });
});

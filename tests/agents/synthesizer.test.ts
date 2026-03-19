// tests/agents/synthesizer.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/notion/working-memory.js', () => ({
  createBlockFlusher: vi.fn().mockReturnValue(vi.fn()),
  updateTokenCount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/notion/knowledge-graph.js', () => ({
  getAllEntries: vi.fn().mockResolvedValue([
    { entityName: 'Cursor', entityType: 'product', claim: 'AI-first editor', confidence: 'high', id: 'e-1', relatedEntityIds: [], createdByTaskId: 't-1' },
  ]),
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
    const text = '## Executive Summary\nCursor is a leading AI editor.';
    onChunk(text);
    return text;
  }),
}));

import { runSynthesizerAgent } from '../../src/agents/synthesizer.js';
import { claimTask, updateTaskStatus } from '../../src/notion/task-bus.js';

const ctx = {
  taskId: 'task-synth',
  workingMemoryId: 'wm-synth',
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

describe('runSynthesizerAgent', () => {
  it('claims task, streams synthesis, marks done, returns working memory page id', async () => {
    const pageId = await runSynthesizerAgent(ctx);
    expect(claimTask).toHaveBeenCalledWith('task-synth', 'synthesizer');
    expect(updateTaskStatus).toHaveBeenCalledWith('task-synth', 'done');
    expect(pageId).toBe('wm-synth');
  });

  it('marks task blocked and rethrows on LLM error', async () => {
    const { streamChat } = await import('../../src/llm.js');
    vi.mocked(streamChat).mockRejectedValueOnce(new Error('LLM timeout'));

    await expect(runSynthesizerAgent(ctx)).rejects.toThrow('LLM timeout');
    expect(updateTaskStatus).toHaveBeenCalledWith('task-synth', 'blocked');
  });
});

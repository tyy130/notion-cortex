// tests/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing orchestrator
vi.mock('../src/notion/bootstrap.js', () => ({
  bootstrapWorkspace: vi.fn().mockResolvedValue({
    taskBus: 'db-tasks',
    workingMemory: 'db-wm',
    knowledgeGraph: 'db-kg',
    approvalGates: 'db-gates',
    outputs: 'db-out',
  }),
}));

vi.mock('../src/notion/task-bus.js', () => ({
  createTask: vi.fn().mockResolvedValue('task-1'),
}));

vi.mock('../src/notion/working-memory.js', () => ({
  createWorkingMemoryPage: vi.fn().mockResolvedValue('wm-page-1'),
}));

vi.mock('../src/notion/approval-gates.js', () => ({
  createApprovalGate: vi.fn().mockResolvedValue('gate-1'),
  pollGateUntilResolved: vi.fn().mockResolvedValue({ status: 'Approved', notes: '' }),
}));

vi.mock('../src/notion/mcp-client.js', () => ({
  createNotionMCPClient: vi.fn().mockResolvedValue({
    tools: [],
    callTool: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../src/agents/scout.js', () => ({
  runScoutAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/agents/analyst.js', () => ({
  runAnalystAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/notion/knowledge-graph.js', () => ({
  computeAndStoreRelations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/agents/synthesizer.js', () => ({
  runSynthesizerAgent: vi.fn().mockResolvedValue('synth-page-1'),
}));

vi.mock('../src/agents/writer.js', () => ({
  runWriterAgent: vi.fn().mockResolvedValue('output-page-1'),
}));

vi.mock('../src/llm.js', () => ({
  resolveModel: vi.fn().mockReturnValue('test-model'),
  streamChat: vi.fn().mockImplementation(async (_p: unknown, _cb: unknown) => {
    return '```json\n["Angle 1","Angle 2","Angle 3","Angle 4","Angle 5"]\n```';
  }),
}));

import { runOrchestrator } from '../src/orchestrator.js';
import { bootstrapWorkspace } from '../src/notion/bootstrap.js';
import { runScoutAgent } from '../src/agents/scout.js';
import { runAnalystAgent } from '../src/agents/analyst.js';
import { runSynthesizerAgent } from '../src/agents/synthesizer.js';
import { runWriterAgent } from '../src/agents/writer.js';
import { computeAndStoreRelations } from '../src/notion/knowledge-graph.js';
import { createTask } from '../src/notion/task-bus.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTION_API_KEY = 'test-key';
});

describe('runOrchestrator', () => {
  it('bootstraps workspace and runs full pipeline', async () => {
    await runOrchestrator('AI coding assistants', 'page-parent', { autoApprove: true });

    expect(bootstrapWorkspace).toHaveBeenCalledWith('page-parent');
    expect(runScoutAgent).toHaveBeenCalledTimes(5);
    expect(runAnalystAgent).toHaveBeenCalledTimes(1);
    expect(computeAndStoreRelations).toHaveBeenCalledWith('db-kg');
    expect(runSynthesizerAgent).toHaveBeenCalledTimes(1);
    expect(runWriterAgent).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'AI coding assistants' }),
      'synth-page-1',
    );
  });

  it('creates a task for each decomposed sub-topic', async () => {
    await runOrchestrator('AI coding assistants', 'page-parent', { autoApprove: true });
    // 5 scout tasks + analyst + synthesizer + writer = 8 total
    expect(createTask).toHaveBeenCalledTimes(8);
  });

  it('skips approval gate when autoApprove is true', async () => {
    const { pollGateUntilResolved } = await import('../src/notion/approval-gates.js');
    await runOrchestrator('AI coding assistants', 'page-parent', { autoApprove: true });
    expect(pollGateUntilResolved).not.toHaveBeenCalled();
  });

  it('waits for approval gate when autoApprove is false', async () => {
    const { pollGateUntilResolved } = await import('../src/notion/approval-gates.js');
    await runOrchestrator('AI coding assistants', 'page-parent', { autoApprove: false });
    expect(pollGateUntilResolved).toHaveBeenCalledTimes(1);
  });

  it('aborts if all scouts fail', async () => {
    vi.mocked(runScoutAgent).mockRejectedValue(new Error('Scout down'));
    await expect(
      runOrchestrator('AI coding assistants', 'page-parent', { autoApprove: true }),
    ).rejects.toThrow('All Scout agents failed');
    expect(runAnalystAgent).not.toHaveBeenCalled();
  });

  it('continues with partial data if some scouts fail', async () => {
    vi.mocked(runScoutAgent)
      .mockResolvedValueOnce(undefined)  // scout 1 succeeds
      .mockRejectedValue(new Error('Scout down')); // rest fail

    await runOrchestrator('AI coding assistants', 'page-parent', { autoApprove: true });
    expect(runAnalystAgent).toHaveBeenCalled();
  });

  it('uses fallback sub-topics when LLM returns no JSON block', async () => {
    const { streamChat } = await import('../src/llm.js');
    vi.mocked(streamChat).mockResolvedValueOnce('Here are some angles: one, two, three.');
    vi.mocked(runScoutAgent).mockResolvedValue(undefined);

    await runOrchestrator('AI coding assistants', 'page-parent', { autoApprove: true });

    // Still runs 5 scouts (fallback always produces exactly 5 angles)
    expect(runScoutAgent).toHaveBeenCalledTimes(5);
  });
});

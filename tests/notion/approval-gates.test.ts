// tests/notion/approval-gates.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/notion/client.js', () => ({ getNotionClient: vi.fn() }));
vi.mock('../../src/concurrency.js', () => ({
  writeQueue: { enqueue: (fn: any) => fn() },
  createWriteQueue: () => ({ enqueue: (fn: any) => fn() }),
  retryWithBackoff: (fn: any) => fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { getNotionClient } from '../../src/notion/client.js';
import { createApprovalGate, pollGateUntilResolved } from '../../src/notion/approval-gates.js';

const mockNotion = {
  pages: { create: vi.fn(), retrieve: vi.fn() },
};

beforeEach(() => {
  vi.mocked(getNotionClient).mockReturnValue(mockNotion as any);
  vi.clearAllMocks();
});

describe('createApprovalGate', () => {
  it('creates a gate page with Pending status', async () => {
    mockNotion.pages.create.mockResolvedValue({ id: 'gate-1' });

    const id = await createApprovalGate('db-gates', {
      gateName: 'Pre-writing review',
      synthesisPageId: 'wm-5',
    });

    expect(id).toBe('gate-1');
    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          status: expect.objectContaining({
            status: expect.objectContaining({ name: 'Pending' }),
          }),
        }),
      }),
    );
  });
});

describe('pollGateUntilResolved', () => {
  it('returns Approved when gate status changes', async () => {
    mockNotion.pages.retrieve
      .mockResolvedValueOnce({ properties: { status: { status: { name: 'Pending' } }, notes: { rich_text: [] } } })
      .mockResolvedValueOnce({ properties: { status: { status: { name: 'Approved' } }, notes: { rich_text: [] } } });

    const result = await pollGateUntilResolved('gate-1', { maxWaitMs: 5000, initialDelayMs: 1 });
    expect(result.status).toBe('Approved');
  });

  it('returns Rejected with notes', async () => {
    mockNotion.pages.retrieve.mockResolvedValue({
      properties: {
        status: { status: { name: 'Rejected' } },
        notes: { rich_text: [{ plain_text: 'Need more data on pricing' }] },
      },
    });

    const result = await pollGateUntilResolved('gate-1', { maxWaitMs: 5000, initialDelayMs: 1 });
    expect(result.status).toBe('Rejected');
    expect(result.notes).toBe('Need more data on pricing');
  });

  it('throws when maxWaitMs is exceeded with gate still Pending', async () => {
    mockNotion.pages.retrieve.mockResolvedValue({
      properties: {
        status: { status: { name: 'Pending' } },
        notes: { rich_text: [] },
      },
    });

    await expect(
      pollGateUntilResolved('gate-1', { maxWaitMs: 1, initialDelayMs: 1 }),
    ).rejects.toThrow(/timed out/);
  });
});

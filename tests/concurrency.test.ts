import { describe, it, expect, vi } from 'vitest';
import { createWriteQueue, retryWithBackoff } from '../src/concurrency.js';

describe('createWriteQueue', () => {
  it('executes tasks', async () => {
    const queue = createWriteQueue();
    const result = await queue.enqueue(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('enforces max 3 concurrent tasks', async () => {
    const queue = createWriteQueue();
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = () =>
      queue.enqueue(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 10));
        concurrent--;
      });

    await Promise.all([task(), task(), task(), task(), task()]);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
});

describe('retryWithBackoff', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, 3, 1); // 1ms base delay for tests
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after maxRetries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(retryWithBackoff(fn, 3, 1)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

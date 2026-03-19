// tests/streaming.test.ts
// Uses vi.useFakeTimers() to avoid real setInterval hanging the test suite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStreamBuffer } from '../src/streaming.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createStreamBuffer', () => {
  it('accumulates tokens and flushes as a single block', async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined);
    const buffer = createStreamBuffer(flushFn, 1000);

    buffer.push('Hello ');
    buffer.push('world');

    await vi.advanceTimersByTimeAsync(1100);
    expect(flushFn).toHaveBeenCalledWith('Hello world');
  });

  it('does not flush empty buffer', async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined);
    createStreamBuffer(flushFn, 1000);

    await vi.advanceTimersByTimeAsync(2000);
    expect(flushFn).not.toHaveBeenCalled();
  });

  it('flushes remaining content on close and returns total char count', async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined);
    const buffer = createStreamBuffer(flushFn, 60000); // long interval

    buffer.push('final content');
    const count = await buffer.close();

    expect(flushFn).toHaveBeenCalledWith('final content');
    expect(count).toBe('final content'.length);
  });

  it('returns cumulative char count across multiple pushes', async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined);
    const buffer = createStreamBuffer(flushFn, 60000);

    buffer.push('hello');
    buffer.push(' world');
    const count = await buffer.close();

    expect(count).toBe(11);
  });

  it('resets buffer after each flush', async () => {
    const flushed: string[] = [];
    const flushFn = vi.fn().mockImplementation(async (text: string) => {
      flushed.push(text);
    });
    const buffer = createStreamBuffer(flushFn, 1000);

    buffer.push('first ');
    await vi.advanceTimersByTimeAsync(1100);
    buffer.push('second');
    await vi.advanceTimersByTimeAsync(1100);

    expect(flushed).toEqual(['first ', 'second']);
  });
});

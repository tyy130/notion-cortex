import pLimit from 'p-limit';

// Shared singleton write queue — all Notion modules import this one instance so
// the total number of concurrent API writes across the entire process is capped at 3.
// (Notion's rate limit is 3 req/s per integration token.)
const _limit = pLimit(3);
export const writeQueue = {
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return _limit(fn);
  },
};

// Kept for tests that need an isolated queue instance without shared state.
export function createWriteQueue() {
  const limit = pLimit(3);
  return {
    enqueue<T>(fn: () => Promise<T>): Promise<T> {
      return limit(fn);
    },
  };
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      await sleep(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

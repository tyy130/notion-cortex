export type FlushFn = (text: string) => Promise<void>;

export interface StreamBuffer {
  push(token: string): void;
  /** Flushes any remaining buffered content and returns the total character count. */
  close(): Promise<number>;
}

// Creates a buffer that accumulates streamed tokens and flushes to Notion
// on a timed interval. Respects the global 3 req/s limit by flushing at
// most once per `flushIntervalMs`.
export function createStreamBuffer(
  flushFn: FlushFn,
  flushIntervalMs = 1000,
): StreamBuffer {
  let accumulated = '';
  let totalChars = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function startTimer() {
    if (timer) return;
    timer = setInterval(async () => {
      if (accumulated.length === 0) return;
      const content = accumulated;
      accumulated = '';
      await flushFn(content);
    }, flushIntervalMs);
  }

  return {
    push(token: string) {
      accumulated += token;
      totalChars += token.length;
      startTimer();
    },

    async close(): Promise<number> {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (accumulated.length > 0) {
        const content = accumulated;
        accumulated = '';
        await flushFn(content);
      }
      return totalChars;
    },
  };
}

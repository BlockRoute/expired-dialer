export type OutboxItem = { speaker: 'rep' | 'owner'; text: string; tStart: number; tEnd: number };
export type SendBatch = (callId: string, batch: OutboxItem[]) => Promise<boolean>;

/**
 * Per-call queue of final segments. Failed batches go back to the front and
 * are retried; `drain` is the end-of-call path that waits for any in-flight
 * send and retries the tail.
 */
export function createOutbox(send: SendBatch, batchMax = 100) {
  const items: OutboxItem[] = [];
  let inflight: Promise<void> | null = null;

  const flush = (callId: string | null): Promise<void> => {
    if (inflight) return inflight;
    if (!callId || items.length === 0) return Promise.resolve();
    const batch = items.splice(0, batchMax);
    inflight = (async () => {
      let ok = false;
      try {
        ok = await send(callId, batch);
      } catch {
        ok = false;
      }
      if (!ok) items.unshift(...batch);
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    push: (item: OutboxItem) => void items.push(item),
    size: () => items.length,
    flush,
    /** Sends everything left for `callId`; gives up after `retries` consecutive failures. Resolves true when empty. */
    async drain(
      callId: string | null,
      { retries = 3, delayMs = 500 }: { retries?: number; delayMs?: number } = {},
    ): Promise<boolean> {
      let failures = 0;
      while (failures <= retries) {
        if (inflight) await inflight;
        if (items.length === 0) return true;
        if (!callId) return false;
        const before = items.length;
        await flush(callId);
        if (items.length < before) continue;
        failures++;
        if (failures <= retries) await new Promise((r) => setTimeout(r, delayMs));
      }
      return items.length === 0;
    },
  };
}

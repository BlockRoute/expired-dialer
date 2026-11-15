import { describe, expect, it } from 'vitest';
import { createOutbox, type OutboxItem } from './transcript-outbox';

const item = (text: string): OutboxItem => ({ speaker: 'owner', text, tStart: 0, tEnd: 1 });

describe('createOutbox', () => {
  it('tail flush uses the captured call id even after the shared ref is nulled', async () => {
    const sent: [string, string[]][] = [];
    const outbox = createOutbox(async (id, batch) => (sent.push([id, batch.map((b) => b.text)]), true));
    let shared: string | null = 'call-old';
    const captured = shared; // taken at cleanup time
    shared = null; // 'saved' resets callId
    outbox.push(item('tail'));
    expect(shared).toBeNull();
    expect(await outbox.drain(captured)).toBe(true);
    expect(sent).toEqual([['call-old', ['tail']]]);
  });

  it('waits for an in-flight flush, then sends the tail', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const outbox = createOutbox(async (_id, batch) => {
      order.push(`start:${batch.map((b) => b.text)}`);
      if (batch[0].text === 'first') await gate;
      order.push(`done:${batch.map((b) => b.text)}`);
      return true;
    });
    outbox.push(item('first'));
    void outbox.flush('c1');
    outbox.push(item('tail'));
    const draining = outbox.drain('c1');
    release();
    expect(await draining).toBe(true);
    expect(order).toEqual(['start:first', 'done:first', 'start:tail', 'done:tail']);
  });

  it('retries a failed tail POST', async () => {
    let calls = 0;
    const outbox = createOutbox(async () => ++calls > 2);
    outbox.push(item('tail'));
    expect(await outbox.drain('c1', { retries: 3, delayMs: 1 })).toBe(true);
    expect(calls).toBe(3);
    expect(outbox.size()).toBe(0);
  });

  it('gives up after the retry budget and keeps the items', async () => {
    const outbox = createOutbox(async () => false);
    outbox.push(item('tail'));
    expect(await outbox.drain('c1', { retries: 1, delayMs: 1 })).toBe(false);
    expect(outbox.size()).toBe(1);
  });

  it('post-close finals go only to the old call id', async () => {
    const ids: string[] = [];
    const oldBox = createOutbox(async (id) => (ids.push(id), true));
    const newBox = createOutbox(async (id) => (ids.push(id), true));
    oldBox.push(item('late final after close'));
    await oldBox.drain('call-old');
    await newBox.drain('call-new');
    expect(ids).toEqual(['call-old']);
  });

  it('batches at batchMax', async () => {
    const sizes: number[] = [];
    const outbox = createOutbox(async (_i, b) => (sizes.push(b.length), true), 2);
    for (const t of 'abcde') outbox.push(item(t));
    await outbox.drain('c1');
    expect(sizes).toEqual([2, 2, 1]);
  });
});

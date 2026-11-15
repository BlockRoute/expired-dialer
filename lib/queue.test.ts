import { describe, it, expect } from 'vitest';
import { orderQueue } from './queue';
import type { LeadRow } from './db/types';

const L = (id: string, o: Partial<LeadRow & { dueCallbackAt: string | null }> = {}) =>
  ({ id, status: 'new', attempt_rounds: 0, next_eligible_at: null, expired_date: null, dueCallbackAt: null, ...o }) as LeadRow & { dueCallbackAt: string | null };
const NOW = new Date('2026-11-16T17:00:00Z');
const ids = (x: LeadRow[]) => x.map((l) => l.id);

describe('orderQueue', () => {
  it('due callbacks first (oldest due first), then fresh by expired_date desc, then retries by next_eligible_at', () => {
    const out = orderQueue([
      L('retryB', { attempt_rounds: 1, next_eligible_at: '2026-11-16T10:00:00Z' }),
      L('retryA', { attempt_rounds: 1, next_eligible_at: '2026-11-16T09:00:00Z' }),
      L('old', { expired_date: '2026-11-01' }),
      L('newest', { expired_date: '2026-11-14' }),
      L('cb2', { status: 'callback', dueCallbackAt: '2026-11-16T15:00:00Z' }),
      L('cb1', { status: 'callback', dueCallbackAt: '2026-11-16T14:00:00Z' }),
    ], NOW);
    expect(ids(out)).toEqual(['cb1', 'cb2', 'newest', 'old', 'retryA', 'retryB']);
  });
  it('future callback is not due; retry not yet eligible is excluded', () => {
    const out = orderQueue([
      L('future', { dueCallbackAt: '2026-11-17T00:00:00Z', expired_date: '2026-11-01' }),
      L('wait', { attempt_rounds: 1, next_eligible_at: '2026-11-17T00:00:00Z' }),
    ], NOW);
    expect(ids(out)).toEqual(['future']);
  });
  it('excludes closed statuses, even with a due callback', () => {
    const out = orderQueue(
      (['dnc', 'dead', 'appointment', 'out_of_state'] as const).map((s) => L(s, { status: s, dueCallbackAt: '2026-11-16T14:00:00Z' })), NOW);
    expect(out).toEqual([]);
  });
});

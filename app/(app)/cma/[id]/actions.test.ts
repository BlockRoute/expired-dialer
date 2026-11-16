import { beforeEach, describe, expect, it, vi } from 'vitest';

const runClaude = vi.fn();
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/lib/ai/anthropic', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/anthropic')>('@/lib/ai/anthropic');
  return { ...actual, runClaude: (...a: unknown[]) => runClaude(...a), aiEnabled: () => true };
});
const cma = {
  id: 'c1',
  address: '2812 Amherst Ridge Dr, Richmond, VA 23235',
  subject: { beds: 3, baths: 2, sqft: 1800, yearBuilt: 1990, lotSqft: 9000 },
  comps: [{ zpid: 'z1', address: '1 A St', soldPrice: 400000, soldDate: '2026-10-01', dom: 10, beds: 3, baths: 2, sqft: 1700, yearBuilt: 1988, lotSqft: 8000, ppsf: 235, distanceMiles: 0.3 }],
  price_range: { low: 390000, high: 410000 },
};
function table() {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: cma, error: null });
  return q;
}
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ from: table }) }));

import { draftNotes } from './actions';

beforeEach(() => runClaude.mockReset());

describe('draftNotes', () => {
  it('asks Sonnet 5.5 at low effort with room for thinking plus the JSON', async () => {
    runClaude.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"favor":"F.","weigh":"W."}' }] });
    expect(await draftNotes('c1', [])).toEqual({ ok: true, favor: 'F.', weigh: 'W.' });
    const args = runClaude.mock.calls[0][0];
    expect(args.model).toBe('claude-sonnet-5-5');
    expect(args.effort).toBe('low');
    expect(args.thinking).toBeUndefined();
    expect(args.maxTokens).toBeGreaterThanOrEqual(4000);
  });

  it('a reply cut off at max_tokens is reported as unusable', async () => {
    runClaude.mockResolvedValue({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"favor":"F.","weigh":"W."}' }] });
    expect(await draftNotes('c1', [])).toEqual({ ok: false, error: 'The draft came back unusable. Try again.' });
  });
});

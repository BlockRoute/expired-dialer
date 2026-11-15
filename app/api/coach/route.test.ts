import { beforeEach, describe, expect, it, vi } from 'vitest';

const jev = vi.fn();
const runClaude = vi.fn();
vi.mock('@/lib/auth', () => ({ requireUserApi: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/lib/typesafe/client', () => ({
  jev: (...a: unknown[]) => jev(...a),
  JevError: class JevError extends Error {
    constructor(m: string, public status: number) {
      super(m);
    }
  },
}));
vi.mock('@/lib/ai/anthropic', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/anthropic')>('@/lib/ai/anthropic');
  return { ...actual, runClaude: (...a: unknown[]) => runClaude(...a), aiEnabled: () => true };
});

const cards = [
  { key: 'a', title: 'Card A', criteria: 'crit a', say: 'Hi %lead.first_name%', why: 'because', active: true, sort: 1 },
  { key: 'b', title: 'Card B', criteria: 'crit b', say: 'B say', why: null, active: true, sort: 2 },
];
const inserted: unknown[] = [];
function table(name: string) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const m of ['select', 'eq', 'not', 'order', 'limit']) q[m] = self;
  q.maybeSingle = async () => ({
    data: name === 'calls' ? { lead_id: '22222222-2222-4222-8222-222222222222' } : name === 'leads' ? { id: 'l1', owner_first_name: 'Jane', list_price: 425000, days_on_market: 10 } : null,
    error: null,
  });
  q.then = (res: (v: unknown) => unknown) => res({ data: name === 'playbook_cards' ? cards : [], error: null });
  q.insert = (row: unknown) => {
    inserted.push(row);
    return { select: () => ({ single: async () => ({ data: { id: 'cc1' }, error: null }) }) };
  };
  return q;
}
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ from: table }) }));

import { POST } from './route';

const req = (turnId = 3) =>
  new Request('http://x/api/coach', {
    method: 'POST',
    body: JSON.stringify({
      callId: '11111111-1111-4111-8111-111111111111',
      leadId: '22222222-2222-4222-8222-222222222222',
      turn: { ownerSaid: 'we are going to relist with Susan next week', transcriptSoFar: 'Rep: hi', turnId },
    }),
  });

beforeEach(() => {
  jev.mockReset();
  runClaude.mockReset();
  inserted.length = 0;
});

describe('POST /api/coach', () => {
  it('returns a rendered single card and records it', async () => {
    jev.mockResolvedValue({
      card: { type: 'choice', choice: 'a', confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } },
      dnc: { type: 'noul', noul: 0.02 },
    });
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.turnId).toBe(3);
    expect(body.cards).toEqual([{ key: 'a', title: 'Card A', say: 'Hi Jane', why: 'because', source: 'jev' }]);
    expect(body.dncP).toBe(0.02);
    expect(body.coachCardId).toBe('cc1');
    expect(inserted).toHaveLength(1);
  });

  it('Jev 529 after retries gives 200 paused, no throw', async () => {
    const { JevError } = await import('@/lib/typesafe/client');
    jev.mockRejectedValue(new JevError('TypeSafe HTTP 529', 529));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ turnId: 3, cards: [], dncP: null, paused: true, coachCardId: null });
  });

  it('Claude throwing on fallback gives cards [] and 200', async () => {
    jev.mockResolvedValue({
      card: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9, a: 0.1 } },
      dnc: { type: 'noul', noul: 0.01 },
    });
    runClaude.mockRejectedValue(new Error('boom'));
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cards).toEqual([]);
    expect(body.coachCardId).toBeNull();
    expect(body.dncP).toBe(0.01);
    expect(body.paused).toBe(true);
  });

  it('a hung Claude fallback times out: paused, cards [], dncP kept', async () => {
    jev.mockResolvedValue({
      card: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9, a: 0.1 } },
      dnc: { type: 'noul', noul: 0.97 },
    });
    runClaude.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const pending = POST(req());
      await vi.advanceTimersByTimeAsync(5000);
      const body = await (await pending).json();
      expect(body).toMatchObject({ cards: [], dncP: 0.97, paused: true, coachCardId: null });
      expect(runClaude.mock.calls[0][0].requestOptions).toEqual({ timeout: 2500, maxRetries: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('call that belongs to another lead returns the paused shape', async () => {
    const r = new Request('http://x/api/coach', {
      method: 'POST',
      body: JSON.stringify({
        callId: '11111111-1111-4111-8111-111111111111',
        leadId: '33333333-3333-4333-8333-333333333333',
        turn: { ownerSaid: 'hello there', transcriptSoFar: '', turnId: 1 },
      }),
    });
    const body = await (await POST(r)).json();
    expect(body.paused).toBe(true);
    expect(jev).not.toHaveBeenCalled();
  });

  it('fallback card is truncated to 20 words and labeled claude', async () => {
    jev.mockResolvedValue({
      card: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9, a: 0.1 } },
      dnc: { type: 'noul', noul: 0.01 },
    });
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
    runClaude.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ title: 'T', say: long, why: 'y' }) }] });
    const body = await (await POST(req())).json();
    expect(body.cards[0].source).toBe('claude');
    expect(body.cards[0].say.split(/\s+/)).toHaveLength(20);
    expect(runClaude.mock.calls[0][0].model).toBe('claude-haiku-5-5');
  });

  it('pair returns two cards with runner-up stored', async () => {
    jev.mockResolvedValue({
      card: { type: 'choice', choice: 'a', confidence: 0.5, probabilities: { a: 0.5, b: 0.45, none: 0.05 } },
      dnc: { type: 'noul', noul: 0.6 },
    });
    const body = await (await POST(req())).json();
    expect(body.cards.map((c: { key: string }) => c.key)).toEqual(['a', 'b']);
    expect(body.dncP).toBe(0.6);
    expect(inserted[0]).toMatchObject({ card_key: 'a', runner_up_key: 'b', runner_up_probability: 0.45 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const jev = vi.fn();
const runClaude = vi.fn();
const afterTasks: Promise<unknown>[] = [];
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: (fn: () => Promise<unknown>) => void afterTasks.push(Promise.resolve().then(fn)) };
});
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
  return { ...actual, runClaude: (...a: unknown[]) => runClaude(...a) };
});

let callRow: Record<string, unknown> | null;
let segments: { speaker: string; text: string; t_start: number }[];
const updates: unknown[] = [];
function table(name: string) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const m of ['select', 'eq', 'is', 'order']) q[m] = self;
  q.maybeSingle = async () => ({
    data: name === 'calls' ? callRow : name === 'settings' ? { outcomes: ['connected', 'dnc', 'appointment_set', 'callback_requested', 'not_interested'] } : null,
    error: null,
  });
  q.then = (res: (v: unknown) => unknown) => res({ data: name === 'transcript_segments' ? segments : [], error: null });
  q.update = (row: unknown) => {
    updates.push(row);
    return q;
  };
  return q;
}
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ from: table }) }));

import { POST } from './route';

const ID = '11111111-1111-4111-8111-111111111111';
const call = () => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: ID }) });
const settle = () => Promise.all(afterTasks.splice(0));

const talk = [
  { speaker: 'rep', text: 'Hi Jane?', t_start: 1 },
  { speaker: 'owner', text: 'Thursday at 4 works.', t_start: 2 },
];
const jevOk = {
  outcome: { type: 'choice', choice: 'appointment_set', confidence: 0.9, probabilities: { appointment_set: 0.9 } },
  appointment: { type: 'noul', noul: 0.9 },
  callback_time: { type: 'noul', noul: 0.1 },
  dnc: { type: 'noul', noul: 0.01 },
};

beforeEach(() => {
  jev.mockReset();
  runClaude.mockReset();
  updates.length = 0;
  afterTasks.length = 0;
  callRow = { id: ID, ai_summary: null, outcome_saved_at: null };
  segments = talk;
});

describe('POST /api/calls/[id]/finish', () => {
  it('returns the prefill and writes the summary after the response', async () => {
    jev.mockResolvedValue(jevOk);
    runClaude.mockResolvedValue({
      content: [{ type: 'text', text: '{"summary":"S","note":"N","next_step":"X"}' }],
    });
    const body = await (await call()).json();
    expect(body.prefill).toEqual({ outcome: 'appointment_set', openCallbackPicker: false, dncSuggested: false });
    expect(jev.mock.calls[0][0]).toEqual({ transcript: 'Rep: Hi Jane?\nOwner: Thursday at 4 works.' });
    await settle();
    expect(runClaude.mock.calls[0][0].model).toBe('claude-sonnet-5-5');
    expect(runClaude.mock.calls[0][0].requestOptions.timeout).toBeGreaterThan(0);
    expect(updates).toEqual([{ ai_summary: { summary: 'S', note: 'N', next_step: 'X' } }]);
  });

  it('404 for an unknown call', async () => {
    callRow = null;
    expect((await call()).status).toBe(404);
  });

  it('no owner speech: no jev, no claude, prefill null', async () => {
    segments = [{ speaker: 'rep', text: 'Hello?', t_start: 1 }];
    const body = await (await call()).json();
    await settle();
    expect(body).toEqual({ prefill: null });
    expect(jev).not.toHaveBeenCalled();
    expect(runClaude).not.toHaveBeenCalled();
  });

  it('Jev error gives 200 with prefill null', async () => {
    const { JevError } = await import('@/lib/typesafe/client');
    jev.mockRejectedValue(new JevError('TypeSafe HTTP 500', 500));
    runClaude.mockResolvedValue({ content: [{ type: 'text', text: '{"summary":"S","note":"N","next_step":"X"}' }] });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prefill: null });
  });

  it('ai_summary already set: no Claude call', async () => {
    callRow = { id: ID, ai_summary: { summary: 'done' }, outcome_saved_at: null };
    jev.mockResolvedValue(jevOk);
    await call();
    await settle();
    expect(runClaude).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('a saved outcome is never prefilled over', async () => {
    callRow = { id: ID, ai_summary: null, outcome_saved_at: '2026-11-15T00:00:00Z' };
    jev.mockResolvedValue(jevOk);
    runClaude.mockResolvedValue({ content: [{ type: 'text', text: '{"summary":"S","note":"N","next_step":"X"}' }] });
    expect(await (await call()).json()).toEqual({ prefill: null });
  });

  it('Claude failure leaves ai_summary null and logs no transcript text', async () => {
    jev.mockResolvedValue(jevOk);
    runClaude.mockRejectedValue(new Error('Thursday at 4 boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call();
    await settle();
    expect(res.status).toBe(200);
    expect(updates).toEqual([]);
    expect(JSON.stringify(err.mock.calls)).not.toContain('Thursday');
    err.mockRestore();
  });
});

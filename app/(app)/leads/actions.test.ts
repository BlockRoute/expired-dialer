import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '@/lib/test/fake-db';

const rpc = vi.fn();
let db: ReturnType<typeof fakeDb>;
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ ...db.client, rpc }) }));

import { clearDncReview, markLeadDnc } from './actions';

const LEAD = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  rpc.mockReset();
  db = fakeDb({ leads: [{ id: LEAD, status: 'working', dnc_review_at: '2026-11-16T15:00:00Z' }] });
});

describe('markLeadDnc', () => {
  it('applies the DNC effects through the mark_lead_dnc RPC (no call id needed)', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await markLeadDnc(LEAD)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('mark_lead_dnc', { p_lead_id: LEAD });
  });
  it('lead not found', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await markLeadDnc(LEAD)).toEqual({ ok: false, error: 'Lead not found.' });
  });
  it('rejects a malformed id without touching the database', async () => {
    expect(await markLeadDnc('nope')).toEqual({ ok: false, error: 'Lead not found.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('clearDncReview', () => {
  it('clears the review flag only; nothing is added to dnc_numbers', async () => {
    expect(await clearDncReview(LEAD)).toEqual({ ok: true });
    expect(db.tables.leads[0]).toMatchObject({ status: 'working', dnc_review_at: null });
    expect(db.log.filter((q) => q.op !== 'select').map((q) => q.table)).toEqual(['leads']);
    expect(rpc).not.toHaveBeenCalled();
  });
});

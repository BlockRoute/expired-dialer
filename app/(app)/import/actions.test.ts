import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '@/lib/test/fake-db';

let db: ReturnType<typeof fakeDb>;
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => db.client }));

import { applyImport, createBatch } from './actions';
import type { ImportedLead } from '@/lib/import/build';

const KEY = '4417 GROVE AVE 23221';
const worked = {
  id: 'L1', normalized_address: KEY, status: 'callback', attempt_rounds: 2, next_eligible_at: '2026-11-20T15:00:00Z',
  visit_open_at: '2026-11-16T17:00:00Z', dnc_review_at: null, list_price: 450000, owner_full_name: 'Jane Doe', batch_id: 'old',
};
const incoming = (o: Partial<ImportedLead> = {}): ImportedLead => ({
  normalizedAddress: KEY,
  fields: { property_address: '4417 Grove Ave', list_price: 425000 },
  phones: [{ number: '+18045550142', position: 1, lineType: 'mobile', vendorDnc: 'callable' }],
  outOfState: false,
  ...o,
});

beforeEach(() => {
  db = fakeDb({ leads: [{ ...worked }], phones: [] });
});

describe('applyImport re-import of a worked lead', () => {
  it('writes only the listing patch: status, rounds, cooldown and the open visit are untouched', async () => {
    await applyImport('b2', [incoming()]);
    const write = db.log.find((q) => q.table === 'leads' && q.op !== 'select')!;
    expect(write.op).toBe('update');
    expect(Object.keys(write.payload as object).sort()).toEqual(['batch_id', 'list_price', 'property_address', 'updated_at']);
    expect(db.tables.leads[0]).toMatchObject({
      status: 'callback', attempt_rounds: 2, next_eligible_at: worked.next_eligible_at, visit_open_at: worked.visit_open_at, list_price: 425000, batch_id: 'b2',
    });
  });

  it('a state change to out_of_state is a separate, guarded status update', async () => {
    await applyImport('b2', [incoming({ outOfState: true })]);
    const writes = db.log.filter((q) => q.table === 'leads' && q.op === 'update');
    expect(writes.map((w) => w.payload)).toContainEqual({ status: 'out_of_state' });
    expect(writes.some((w) => 'status' in (w.payload as object) && 'list_price' in (w.payload as object))).toBe(false);
  });
});

describe('createBatch', () => {
  it('rejects a scrub date in the future', async () => {
    await expect(
      createBatch({ fileName: 'f.csv', vendor: 'v', scrubDate: '2099-01-01', scrubbedByVendor: true, totalRows: 1 }),
    ).rejects.toThrow('Scrub date cannot be in the future');
    expect(db.log.filter((q) => q.op === 'insert')).toEqual([]);
  });
});

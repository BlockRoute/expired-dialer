import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { fakeDb, type QueryLog } from '@/lib/test/fake-db';

const TOKEN = 'test-auth-token';
const APP_URL = 'https://dialer.example.com';
let db: ReturnType<typeof fakeDb>;
const adminFactory = vi.fn(() => db.client);
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => adminFactory() }));

import { POST } from './route';

const LEAD = 'lead-1';
const PHONE = 'phone-1';
const NUMBER = '+18045550142';
const hours = { mon: ['09:00', '20:00'], tue: ['09:00', '20:00'], wed: ['09:00', '20:00'], thu: ['09:00', '20:00'], fri: ['09:00', '20:00'], sat: ['09:00', '20:00'], sun: null };

function seed() {
  return {
    leads: [{ id: LEAD, status: 'new', attempt_rounds: 0, next_eligible_at: null, visit_open_at: null, dnc_review_at: null }],
    phones: [{ id: PHONE, lead_id: LEAD, number: NUMBER, status: 'ok', vendor_dnc: 'callable', batch_id: 'b1', position: 1 }],
    settings: [{ id: 1, hours, max_rounds: 3, round_gap_hours: 24, ring_timeout_s: 25, caller_id: '+18045550000' }],
    import_batches: [{ id: 'b1', scrubbed_by_vendor: true, scrub_date: '2026-11-01' }],
    dnc_numbers: [] as Record<string, unknown>[],
    calls: [] as Record<string, unknown>[],
  };
}

function voice(params: Record<string, string>, opts: { forged?: boolean } = {}) {
  const sig = twilio.getExpectedTwilioSignature(TOKEN, `${APP_URL}/api/twilio/voice`, params);
  return POST(
    new Request('http://internal.local/api/twilio/voice', {
      method: 'POST',
      headers: { 'x-twilio-signature': opts.forged ? 'forged' : sig, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }),
  );
}
const params = (o: Record<string, string> = {}) => ({ To: NUMBER, LeadId: LEAD, PhoneId: PHONE, CallSid: 'CA1', ...o });
const writes = (log: QueryLog[]) => log.filter((q) => q.op !== 'select');

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.APP_URL = APP_URL;
  db = fakeDb(seed());
  adminFactory.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T12:00:00-05:00')); // Monday noon ET
});
afterEach(() => vi.useRealTimers());

describe('POST /api/twilio/voice', () => {
  it('forged signature: 403 and the database is never touched', async () => {
    const res = await voice(params(), { forged: true });
    expect(res.status).toBe(403);
    expect(adminFactory).not.toHaveBeenCalled();
  });

  it('success: inserts the call row, then opens the visit', async () => {
    const text = await (await voice(params())).text();
    expect(text).toContain('<Dial');
    expect(text).toContain(NUMBER);
    const w = writes(db.log);
    expect(w.map((q) => `${q.op}:${q.table}`)).toEqual(['insert:calls', 'update:leads']);
    expect(w[0].payload).toMatchObject({ lead_id: LEAD, phone_id: PHONE, twilio_parent_sid: 'CA1', direction: 'outbound' });
    expect(w[1].filters).toContainEqual(['visit_open_at', null]);
    expect(db.tables.leads[0].visit_open_at).not.toBeNull();
  });

  it('an already-open visit keeps its original timestamp', async () => {
    db.tables.leads[0].visit_open_at = '2026-11-16T16:00:00.000Z';
    await voice(params());
    expect(db.tables.leads[0].visit_open_at).toBe('2026-11-16T16:00:00.000Z');
  });

  const blocked = async (expected: string) => {
    const text = await (await voice(params())).text();
    expect(text).toContain(expected);
    expect(text).not.toContain('<Dial');
    expect(writes(db.log)).toEqual([]);
    expect(db.tables.leads[0].visit_open_at).toBeNull();
  };

  it('internal DNC: blocked, nothing inserted, no visit opened', async () => {
    db.tables.dnc_numbers.push({ number: NUMBER });
    await blocked('Blocked: internal dnc');
  });

  it('null batch_id: blocked as unscrubbed', async () => {
    db.tables.phones[0].batch_id = null;
    await blocked('Blocked: unscrubbed');
  });

  it('outside hours: blocked', async () => {
    vi.setSystemTime(new Date('2026-11-16T20:30:00-05:00'));
    await blocked('Blocked: outside hours');
  });

  it('lead awaiting DNC review: blocked', async () => {
    db.tables.leads[0].dnc_review_at = '2026-11-16T15:00:00Z';
    await blocked('Blocked: dnc review');
  });

  it('the number is vendor do_not_call on another lead: blocked here too', async () => {
    db.tables.phones.push({ id: 'phone-9', lead_id: 'lead-9', number: NUMBER, status: 'ok', vendor_dnc: 'do_not_call', batch_id: 'b1', position: 1 });
    await blocked('Blocked: vendor dnc');
  });

  it('To does not match the phone: blocked', async () => {
    const text = await (await voice(params({ To: '+18045559999' }))).text();
    expect(text).toContain('number does not match');
    expect(writes(db.log)).toEqual([]);
  });

  it('a phone that belongs to another lead: blocked', async () => {
    db.tables.phones[0].lead_id = 'lead-2';
    const text = await (await voice(params())).text();
    expect(text).toContain('unknown lead or phone');
    expect(writes(db.log)).toEqual([]);
  });
});

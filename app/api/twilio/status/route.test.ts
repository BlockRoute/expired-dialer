import { beforeEach, describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { fakeDb } from '@/lib/test/fake-db';

const TOKEN = 'test-auth-token';
const APP_URL = 'https://dialer.example.com';
let db: ReturnType<typeof fakeDb>;
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => db.client }));

import { POST } from './route';

function status(query: string, params: Record<string, string>) {
  const path = `/api/twilio/status?${query}`;
  const sig = twilio.getExpectedTwilioSignature(TOKEN, `${APP_URL}${path}`, params);
  return POST(
    new Request(`http://internal.local${path}`, {
      method: 'POST',
      headers: { 'x-twilio-signature': sig, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }),
  );
}

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.APP_URL = APP_URL;
  db = fakeDb({
    calls: [{ id: 'c1', status: 'completed', ended_at: '2026-11-16T17:05:00Z', answered_at: '2026-11-16T17:00:00Z', twilio_child_sid: 'CA2', outcome: 'connected' }],
  });
});

describe('POST /api/twilio/status', () => {
  it('an in-progress callback arriving after completed never regresses the row', async () => {
    const res = await status('callId=c1&leg=child', { CallStatus: 'in-progress', CallSid: 'CA2' });
    expect(res.status).toBe(200);
    expect(db.log.filter((q) => q.op === 'update')).toEqual([]);
    expect(db.tables.calls[0]).toMatchObject({ status: 'completed', outcome: 'connected' });
  });

  it('moves forward with an update guarded on the status it read', async () => {
    db.tables.calls[0] = { id: 'c1', status: 'ringing', ended_at: null, answered_at: null, twilio_child_sid: null, outcome: null };
    await status('callId=c1&leg=child', { CallStatus: 'in-progress', CallSid: 'CA2' });
    const update = db.log.find((q) => q.op === 'update')!;
    expect(update.filters).toContainEqual(['status', 'ringing']);
    expect(db.tables.calls[0]).toMatchObject({ status: 'in-progress', twilio_child_sid: 'CA2' });
  });
});

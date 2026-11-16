import { beforeEach, describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { fakeDb } from '@/lib/test/fake-db';

const TOKEN = 'test-auth-token';
const APP_URL = 'https://dialer.example.com';
let db: ReturnType<typeof fakeDb>;
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => db.client }));

import { POST } from './route';

const params = { From: '+18045550142', CallSid: 'CA9' };
function inbound() {
  const sig = twilio.getExpectedTwilioSignature(TOKEN, `${APP_URL}/api/twilio/inbound`, params);
  return POST(
    new Request('http://internal.local/api/twilio/inbound', {
      method: 'POST',
      headers: { 'x-twilio-signature': sig, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }),
  );
}

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.APP_URL = APP_URL;
  process.env.DANIEL_CELL = '+18045551111';
});

describe('POST /api/twilio/inbound', () => {
  it('forwards to the cell even when logging the call fails', async () => {
    db = fakeDb({ phones: [], calls: [] }, { failInsert: ['calls'] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const text = await (await inbound()).text();
    expect(text).toContain('<Dial');
    expect(text).toContain('+18045551111');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

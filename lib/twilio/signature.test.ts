import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import twilio from 'twilio';
import { verifyTwilioRequest } from './signature';

const TOKEN = 'test-auth-token';
const PARAMS = { To: '+18045550100', LeadId: 'l1', PhoneId: 'p1', CallSid: 'CA123' };

function signed(params: Record<string, string>, url = 'https://example.com/api/twilio/voice?x=1') {
  const sig = twilio.getExpectedTwilioSignature(TOKEN, url, PARAMS);
  return {
    request: new Request('http://internal.local/api/twilio/voice?x=1', {
      method: 'POST',
      headers: { 'x-twilio-signature': sig },
    }),
    params,
  };
}

describe('verifyTwilioRequest', () => {
  const env = { t: process.env.TWILIO_AUTH_TOKEN, u: process.env.APP_URL };
  beforeEach(() => {
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    process.env.APP_URL = 'https://example.com';
  });
  afterEach(() => {
    if (env.t === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = env.t;
    if (env.u === undefined) delete process.env.APP_URL; else process.env.APP_URL = env.u;
  });

  it('accepts a correctly signed request (verifies against APP_URL, not request host)', () => {
    const { request, params } = signed(PARAMS);
    expect(verifyTwilioRequest(request, params)).toBe(true);
  });
  it('rejects when a param changes', () => {
    const { request } = signed(PARAMS);
    expect(verifyTwilioRequest(request, { ...PARAMS, To: '+18045550111' })).toBe(false);
  });
  it('rejects a missing signature', () => {
    const req = new Request('http://internal.local/api/twilio/voice?x=1', { method: 'POST' });
    expect(verifyTwilioRequest(req, PARAMS)).toBe(false);
  });
});

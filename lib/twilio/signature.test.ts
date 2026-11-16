import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import twilio from 'twilio';
import { expectedTwilioSignature, validateTwilioSignature, verifyTwilioRequest } from './signature';

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

  it('accepts a correctly signed request (verifies against APP_URL, not request host)', async () => {
    const { request, params } = signed(PARAMS);
    expect(await verifyTwilioRequest(request, params)).toBe(true);
  });
  it('rejects when a param changes', async () => {
    const { request } = signed(PARAMS);
    expect(await verifyTwilioRequest(request, { ...PARAMS, To: '+18045550111' })).toBe(false);
  });
  it('rejects a missing signature', async () => {
    const req = new Request('http://internal.local/api/twilio/voice?x=1', { method: 'POST' });
    expect(await verifyTwilioRequest(req, PARAMS)).toBe(false);
  });
  it('rejects an empty signature header', async () => {
    const req = new Request('http://internal.local/api/twilio/voice?x=1', {
      method: 'POST',
      headers: { 'x-twilio-signature': '' },
    });
    expect(await verifyTwilioRequest(req, PARAMS)).toBe(false);
  });
  it('fails closed without TWILIO_AUTH_TOKEN', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const { request, params } = signed(PARAMS);
    expect(await verifyTwilioRequest(request, params)).toBe(false);
  });
  it('fails closed without APP_URL', async () => {
    delete process.env.APP_URL;
    const { request, params } = signed(PARAMS);
    expect(await verifyTwilioRequest(request, params)).toBe(false);
  });
  it('fails closed (false, never throws) when APP_URL is not a URL', async () => {
    process.env.APP_URL = 'not a url';
    const { request, params } = signed(PARAMS);
    await expect(verifyTwilioRequest(request, params)).resolves.toBe(false);
  });
  it('accepts APP_URL with a trailing slash', async () => {
    process.env.APP_URL = 'https://example.com/';
    const { request, params } = signed(PARAMS);
    expect(await verifyTwilioRequest(request, params)).toBe(true);
  });
  it('rejects a signature made for a different path or query', async () => {
    const other = signed(PARAMS, 'https://example.com/api/twilio/status?x=1').request;
    expect(await verifyTwilioRequest(other, PARAMS)).toBe(false);
    const otherQuery = signed(PARAMS, 'https://example.com/api/twilio/voice?x=2').request;
    expect(await verifyTwilioRequest(otherQuery, PARAMS)).toBe(false);
  });
  it('rejects a signature made with another token', async () => {
    const sig = twilio.getExpectedTwilioSignature('other-token', 'https://example.com/api/twilio/voice?x=1', PARAMS);
    const req = new Request('http://internal.local/api/twilio/voice?x=1', {
      method: 'POST',
      headers: { 'x-twilio-signature': sig },
    });
    expect(await verifyTwilioRequest(req, PARAMS)).toBe(false);
  });
});

// Differential parity against the twilio library (devDependency only).
describe('Web Crypto signature parity with twilio@6', () => {
  const URLS = [
    'https://dialer.example.com/api/twilio/voice',
    'https://dialer.example.com/api/twilio/status?callId=7d0c2c1e-0b7a-4c55-9a51-6f8f7d2e9a10&leg=dial',
    'https://dialer.example.com/api/twilio/status?callId=7d0c2c1e-0b7a-4c55-9a51-6f8f7d2e9a10&leg=child',
    'https://dialer.example.com/api/twilio/recording?callId=abc',
    'https://dialer.example.com:443/api/twilio/voice',
    'http://dialer.example.com/api/twilio/inbound',
    'http://dialer.example.com:80/api/twilio/inbound',
    'https://expired-dialer.someone.workers.dev/api/twilio/voice?a=1&b=two%20words',
    'https://user:pw@dialer.example.com/api/twilio/voice',
    'https://[::1]/api/twilio/voice',
    'https://dialer.example.com:8443/api/twilio/voice',
  ];
  const PARAM_SETS: Record<string, string>[] = [
    {},
    PARAMS,
    { CallSid: 'CA1', CallStatus: 'in-progress', Caller: 'client:daniel', From: 'client:daniel', AccountSid: 'AC123' },
    { Body: 'héllo wörld ☎️ & <tags> = "quotes"', Zeta: 'z', alpha: 'a', Alpha: 'A', _under: '_', '1num': '1' },
    { RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1', RecordingStatus: 'completed', Empty: '' },
  ];

  it('produces the same signature bytes as getExpectedTwilioSignature', async () => {
    for (const url of URLS) {
      for (const params of PARAM_SETS) {
        expect(await expectedTwilioSignature(TOKEN, url, params)).toBe(twilio.getExpectedTwilioSignature(TOKEN, url, params));
      }
    }
  });

  it('accepts every library signature, and agrees with validateRequest on tampering', async () => {
    for (const url of URLS) {
      for (const params of PARAM_SETS) {
        const sig = twilio.getExpectedTwilioSignature(TOKEN, url, params);
        expect(await validateTwilioSignature(TOKEN, sig, url, params)).toBe(true);
        expect(twilio.validateRequest(TOKEN, sig, url, params)).toBe(true);

        const cases: [string, string, string, Record<string, string>][] = [
          ['token', 'wrong-token', url, params],
          ['url', TOKEN, url.replace('/api/', '/apx/'), params],
          ['added param', TOKEN, url, { ...params, Injected: '1' }],
          ['value', TOKEN, url, Object.fromEntries(Object.entries({ ...params, To: 'x' }).map(([k, v]) => [k, v + '!']))],
        ];
        for (const [, token, u, p] of cases) {
          const ours = await validateTwilioSignature(token, sig, u, p);
          expect(ours).toBe(false);
          expect(ours).toBe(twilio.validateRequest(token, sig, u, p));
        }
        // Tampered or truncated signature strings.
        for (const bad of [sig.slice(0, -1), sig + 'A', sig.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')), '', 'forged']) {
          expect(await validateTwilioSignature(TOKEN, bad, url, params)).toBe(false);
          expect(twilio.validateRequest(TOKEN, bad, url, params)).toBe(false);
        }
      }
    }
  });

  it('accepts the same default-port variants as validateRequest', async () => {
    const pairs = [
      ['https://dialer.example.com/api/twilio/voice', 'https://dialer.example.com:443/api/twilio/voice'],
      ['http://dialer.example.com/api/twilio/voice?q=1', 'http://dialer.example.com:80/api/twilio/voice?q=1'],
    ];
    for (const [plain, withPort] of pairs) {
      for (const [signedUrl, receivedUrl] of [[plain, withPort], [withPort, plain]]) {
        const sig = twilio.getExpectedTwilioSignature(TOKEN, signedUrl, PARAMS);
        expect(twilio.validateRequest(TOKEN, sig, receivedUrl, PARAMS)).toBe(true);
        expect(await validateTwilioSignature(TOKEN, sig, receivedUrl, PARAMS)).toBe(true);
      }
    }
    // A non-default port is not interchangeable, in either implementation.
    const sig = twilio.getExpectedTwilioSignature(TOKEN, 'https://dialer.example.com:8443/api/twilio/voice', PARAMS);
    expect(twilio.validateRequest(TOKEN, sig, 'https://dialer.example.com/api/twilio/voice', PARAMS)).toBe(false);
    expect(await validateTwilioSignature(TOKEN, sig, 'https://dialer.example.com/api/twilio/voice', PARAMS)).toBe(false);
    expect(await validateTwilioSignature(TOKEN, sig, 'https://dialer.example.com:8443/api/twilio/voice', PARAMS)).toBe(true);
  });

  it('accepts the normalized-URL variant as validateRequest does', async () => {
    // Twilio signed the URL as `new URL()` normalizes it; the received string is unnormalized.
    const received = 'https://Dialer.Example.com/api/twilio/voice?x=a b';
    const normalized = new URL(received).toString();
    expect(normalized).not.toBe(received);
    const sig = twilio.getExpectedTwilioSignature(TOKEN, normalized, PARAMS);
    expect(twilio.validateRequest(TOKEN, sig, received, PARAMS)).toBe(true);
    expect(await validateTwilioSignature(TOKEN, sig, received, PARAMS)).toBe(true);
  });

  it('a request through verifyTwilioRequest validates on a port-variant APP_URL', async () => {
    const prev = { t: process.env.TWILIO_AUTH_TOKEN, u: process.env.APP_URL };
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    process.env.APP_URL = 'https://dialer.example.com:443';
    try {
      const sig = twilio.getExpectedTwilioSignature(TOKEN, 'https://dialer.example.com/api/twilio/voice', PARAMS);
      const req = new Request('http://internal.local/api/twilio/voice', { method: 'POST', headers: { 'x-twilio-signature': sig } });
      expect(await verifyTwilioRequest(req, PARAMS)).toBe(true);
    } finally {
      if (prev.t === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = prev.t;
      if (prev.u === undefined) delete process.env.APP_URL; else process.env.APP_URL = prev.u;
    }
  });
});

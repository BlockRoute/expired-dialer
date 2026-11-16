import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { updateTwilioCall, voiceToken } from './client';

const ENV = {
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_API_KEY_SID: 'SK00000000000000000000000000000000',
  TWILIO_API_KEY_SECRET: 'api-key-secret',
  TWILIO_TWIML_APP_SID: 'AP00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'auth-token',
};
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const decode = (jwt: string) => {
  const [h, p] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
  };
};

function libraryToken() {
  const { AccessToken } = twilio.jwt;
  const token = new AccessToken(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_API_KEY_SID, ENV.TWILIO_API_KEY_SECRET, {
    identity: 'daniel',
    ttl: 3600,
  });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: ENV.TWILIO_TWIML_APP_SID, incomingAllow: false }));
  return token.toJwt();
}

describe('voiceToken parity with twilio.jwt.AccessToken + VoiceGrant', () => {
  it('has the same header and grants as the library token', async () => {
    const ours = decode(await voiceToken('daniel'));
    const lib = decode(libraryToken());
    expect(ours.header).toEqual(lib.header);
    expect(ours.header).toEqual({ alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' });
    expect(ours.payload.grants).toEqual(lib.payload.grants);
    expect(ours.payload.iss).toBe(lib.payload.iss);
    expect(ours.payload.sub).toBe(lib.payload.sub);
    expect(Object.keys(ours.payload).sort()).toEqual(Object.keys(lib.payload).sort());
  });

  it('is byte-identical to the library token at the same instant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T17:00:00Z'));
    expect(await voiceToken('daniel')).toBe(libraryToken());
  });

  it('sets jti, iat and exp from the current second with a one-hour ttl', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T17:00:00.900Z'));
    const now = Math.floor(Date.parse('2026-11-16T17:00:00Z') / 1000);
    const { payload } = decode(await voiceToken('daniel'));
    expect(payload.jti).toBe(`${ENV.TWILIO_API_KEY_SID}-${now}`);
    expect(payload.iat).toBe(now);
    expect(payload.exp).toBe(now + 3600);
  });

  it('verifies with the API key secret (HS256), and not with another secret', async () => {
    const jwt = await voiceToken('daniel');
    const [h, p, s] = jwt.split('.');
    const mac = (secret: string) => createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    expect(s).toBe(mac(ENV.TWILIO_API_KEY_SECRET));
    expect(s).not.toBe(mac('other-secret'));
  });
});

describe('updateTwilioCall (replaces client.calls(sid).update)', () => {
  it('POSTs form-encoded Twiml with Basic account auth', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await updateTwilioCall('CA123', { Twiml: '<Response><Play>https://x/a.mp3?t=1&u=2</Play><Hangup/></Response>' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ENV.TWILIO_ACCOUNT_SID}/Calls/CA123.json`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from(`${ENV.TWILIO_ACCOUNT_SID}:${ENV.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
    );
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      Twiml: '<Response><Play>https://x/a.mp3?t=1&u=2</Play><Hangup/></Response>',
    });
  });

  it('POSTs Status=completed for the parent hangup', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await updateTwilioCall('CA1', { Status: 'completed' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toBe('Status=completed');
  });

  it('throws on a non-2xx response, with Twilio\'s message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 21220, message: 'Call is not in-progress' }), { status: 400 })));
    await expect(updateTwilioCall('CA1', { Status: 'completed' })).rejects.toThrow('Twilio call update failed (400): Call is not in-progress');
  });

  it('throws on a non-2xx response without a JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway', { status: 502 })));
    await expect(updateTwilioCall('CA1', { Status: 'completed' })).rejects.toThrow('Twilio call update failed (502)');
  });
});

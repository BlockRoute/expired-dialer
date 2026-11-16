// Server-only: reads Twilio secrets. Fail loudly if bundled into a browser.
if (typeof window !== 'undefined') throw new Error('lib/twilio/client is server-only');

const TTL_SECONDS = 3600;
// The twilio SDK's default HTTP request timeout.
const REST_TIMEOUT_MS = 30_000;

const base64url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const jsonPart = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/**
 * Short-lived Voice access token for the browser Device (outgoing only).
 * Same JWT that twilio.jwt.AccessToken + VoiceGrant({ outgoingApplicationSid,
 * incomingAllow: false }).toJwt() emits (twilio@6.3.0): HS256 with the API key
 * secret; VoiceGrant omits `incoming` unless incomingAllow is true.
 */
export async function voiceToken(identity: 'daniel'): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const keySid = process.env.TWILIO_API_KEY_SID!;
  const secret = process.env.TWILIO_API_KEY_SECRET!;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${keySid}-${now}`,
    grants: { identity, voice: { outgoing: { application_sid: process.env.TWILIO_TWIML_APP_SID! } } },
    iat: now,
    exp: now + TTL_SECONDS,
    iss: keySid,
    sub: accountSid,
  };
  const signingInput = `${jsonPart(header)}.${jsonPart(payload)}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signingInput)));
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Updates a live call (account auth), as client.calls(sid).update() did:
 * POST /2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}.json, form-encoded.
 * Throws on any non-2xx response.
 */
export async function updateTwilioCall(callSid: string, update: { Twiml: string } | { Status: 'completed' }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = btoa(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN!}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`,
    {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(update),
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const detail = typeof body?.message === 'string' ? `: ${body.message}` : '';
    throw new Error(`Twilio call update failed (${res.status})${detail}`);
  }
}

/**
 * Verifies X-Twilio-Signature. Twilio signs APP_URL + path + query (the public
 * URL it was configured with), which can differ from the internal URL the
 * Worker sees, so validate against exactly that and never request.url's origin.
 *
 * Web Crypto port of twilio.validateRequest (twilio@6.3.0 lib/webhooks/webhooks.js):
 * HMAC-SHA1 (base64) over the URL followed by the params sorted by key and
 * concatenated as key+value, compared in constant time, accepting the URL with
 * and without its default port, as received and as normalized by `new URL()`.
 * Fail-closed: a missing header, token or APP_URL, or any exception, is invalid.
 */
export async function verifyTwilioRequest(request: Request, params: Record<string, string>): Promise<boolean> {
  try {
    const signature = request.headers.get('x-twilio-signature');
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const appUrl = process.env.APP_URL;
    if (!signature || !authToken || !appUrl) return false;
    const { pathname, search } = new URL(request.url);
    const url = appUrl.replace(/\/+$/, '') + pathname + search;
    return await validateTwilioSignature(authToken, signature, url, params);
  } catch {
    return false;
  }
}

/** Same URL candidates, in the same order, as twilio.validateRequest (minus the legacy-querystring re-encoding). */
export async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const matches = async (candidate: string) =>
    safeEqual(signature, await expectedTwilioSignature(authToken, candidate, params));
  if ((await matches(removePort(url))) || (await matches(addPort(url)))) return true;
  const normalized = new URL(url).toString();
  return (await matches(removePort(normalized))) || (await matches(addPort(normalized)));
}

export async function expectedTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  let binary = '';
  for (const byte of mac) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Constant-time over equal lengths; the expected length is fixed by SHA-1, so an early length exit leaks nothing secret. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// splitUrl/addPort/removePort mirror the twilio library: split without
// normalizing, so the path and query keep the exact characters Twilio signed.
function splitUrl(url: string) {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i.exec(url);
  if (!match) return null;
  const [prefix, scheme, authority] = match;
  const userInfoEnd = authority.lastIndexOf('@');
  const hostAndPort = authority.slice(userInfoEnd + 1);
  // A colon only starts the port after the closing bracket of an IPv6 literal.
  const portStart = hostAndPort.indexOf(':', hostAndPort.lastIndexOf(']') + 1);
  return {
    scheme,
    userInfo: authority.slice(0, userInfoEnd + 1),
    host: portStart === -1 ? hostAndPort : hostAndPort.slice(0, portStart),
    port: portStart === -1 ? '' : hostAndPort.slice(portStart),
    rest: url.slice(prefix.length),
  };
}

function addPort(url: string): string {
  const parts = splitUrl(url);
  if (!parts || parts.port) return url;
  const port = parts.scheme.toLowerCase() === 'https://' ? ':443' : ':80';
  return parts.scheme + parts.userInfo + parts.host + port + parts.rest;
}

function removePort(url: string): string {
  const parts = splitUrl(url);
  if (!parts) return url;
  return parts.scheme + parts.userInfo + parts.host + parts.rest;
}

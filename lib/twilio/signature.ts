import twilio from 'twilio';

/**
 * Verifies X-Twilio-Signature. Twilio signs APP_URL + path + query (the public
 * URL it was configured with), which can differ from the internal URL Netlify
 * hands the function, so validate against exactly that and never request.url's origin.
 */
export function verifyTwilioRequest(request: Request, params: Record<string, string>): boolean {
  const signature = request.headers.get('x-twilio-signature');
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const appUrl = process.env.APP_URL;
  if (!signature || !authToken || !appUrl) return false;
  const { pathname, search } = new URL(request.url);
  const url = appUrl.replace(/\/+$/, '') + pathname + search;
  return twilio.validateRequest(authToken, signature, url, params);
}

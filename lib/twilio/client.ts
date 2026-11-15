import twilio from 'twilio';

// Server-only: reads Twilio secrets. Fail loudly if bundled into a browser.
if (typeof window !== 'undefined') throw new Error('lib/twilio/client is server-only');

const TTL_SECONDS = 3600;

/** Short-lived Voice access token for the browser Device (outgoing only). */
export function voiceToken(identity: 'daniel'): string {
  const { AccessToken } = twilio.jwt;
  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_API_KEY_SID!,
    process.env.TWILIO_API_KEY_SECRET!,
    { identity, ttl: TTL_SECONDS },
  );
  token.addGrant(
    new AccessToken.VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID!,
      incomingAllow: false,
    }),
  );
  return token.toJwt();
}

import type { BlockReason } from '@/lib/guardrails';

export const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const baseUrl = () => (process.env.APP_URL ?? '').replace(/\/+$/, '');

export function dialTwiml(opts: { to: string; callerId: string; callId: string; ringTimeoutS: number }): string {
  const base = baseUrl();
  const callId = encodeURIComponent(opts.callId);
  const recording = escapeXml(`${base}/api/twilio/recording?callId=${callId}`);
  const action = escapeXml(`${base}/api/twilio/status?callId=${callId}&leg=dial`);
  const child = escapeXml(`${base}/api/twilio/status?callId=${callId}&leg=child`);
  return (
    '<Response>' +
    `<Dial callerId="${escapeXml(opts.callerId)}" timeout="${Math.round(opts.ringTimeoutS)}"` +
    ` record="record-from-answer-dual" recordingStatusCallback="${recording}" action="${action}">` +
    `<Number statusCallbackEvent="initiated ringing answered completed" statusCallback="${child}">` +
    `${escapeXml(opts.to)}</Number></Dial></Response>`
  );
}

/** Spoken to Daniel only, in the browser; never reaches the lead. */
export function messageTwiml(message: string): string {
  return `<Response><Say>${escapeXml(message)}</Say><Hangup/></Response>`;
}

export function rejectTwiml(reason: BlockReason): string {
  return messageTwiml(`Blocked: ${reason.replace(/_/g, ' ')}`);
}

/** Inbound call forwarded to Daniel's cell, showing the original caller's number. */
export function forwardTwiml(opts: { to: string; callerId: string }): string {
  return `<Response><Dial callerId="${escapeXml(opts.callerId)}">${escapeXml(opts.to)}</Dial></Response>`;
}

/** Voicemail drop: plays a recording to the lead, then hangs up. */
export function playTwiml(url: string): string {
  return `<Response><Play>${escapeXml(url)}</Play><Hangup/></Response>`;
}

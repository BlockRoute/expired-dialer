import type { CallRow, CallStatus } from '@/lib/db/types';

const TERMINAL: CallStatus[] = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];

const rank = (s: CallStatus): number =>
  s === 'queued' ? 0 : s === 'ringing' ? 1 : s === 'in-progress' ? 2 : 3;

const isTerminal = (s: CallStatus) => TERMINAL.includes(s);

/** Number statusCallback `CallStatus`; Twilio's `initiated` is our `queued`. */
export function twilioCallStatus(raw: string | undefined): CallStatus | null {
  if (raw === 'initiated') return 'queued';
  return raw && (['queued', 'ringing', 'in-progress', ...TERMINAL] as string[]).includes(raw)
    ? (raw as CallStatus)
    : null;
}

/** Dial action `DialCallStatus`: terminal only; `answered` counts as completed. */
export function dialCallStatus(raw: string | undefined): CallStatus | null {
  if (raw === 'answered') return 'completed';
  return raw && (TERMINAL as string[]).includes(raw) ? (raw as CallStatus) : null;
}

/**
 * Pure state machine for a call row. Status only moves forward, terminal is
 * final, and `outcome` is never touched. Returns null when nothing changes.
 */
export function nextCallState(
  current: CallRow,
  event: { status: CallStatus; at: string; childSid?: string; answeredBy?: string },
): Partial<CallRow> | null {
  if (isTerminal(current.status)) return null;

  const patch: Partial<CallRow> = {};
  if (rank(event.status) > rank(current.status)) {
    patch.status = event.status;
    if (event.status === 'in-progress' && !current.answered_at) patch.answered_at = event.at;
    if (isTerminal(event.status) && !current.ended_at) patch.ended_at = event.at;
  }
  if (event.childSid && event.childSid !== current.twilio_child_sid) {
    patch.twilio_child_sid = event.childSid;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

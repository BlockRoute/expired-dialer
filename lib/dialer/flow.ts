import { checkDial, type BlockReason } from '../guardrails';
import type { Advance } from '../outcomes';
import type { ImportBatchRow, LeadRow, PhoneRow, SettingsRow } from '../db/types';

/** A queued lead with its dialable phones, already in call order. */
export type FlowLead = { lead: LeadRow; phones: PhoneRow[] };

export type CallState = 'idle' | 'dialing' | 'in_call' | 'ended';

export type FlowState = {
  queue: FlowLead[];
  phoneIndex: number;
  callState: CallState;
  /** `calls.id` of the active/just-ended call; null until the server row is known. */
  callId: string | null;
};

export type FlowAction =
  | { type: 'load'; queue: FlowLead[] }
  | { type: 'dial' }
  | { type: 'accepted' }
  | { type: 'call_id'; callId: string }
  | { type: 'disconnected' }
  | { type: 'saved'; advance: Advance }
  | { type: 'skip' }
  /** The lead was closed outside an outcome save (Mark lead DNC): move on whatever the call state. */
  | { type: 'lead_closed' };

export const initialFlow: FlowState = { queue: [], phoneIndex: 0, callState: 'idle', callId: null };

/** Phones still worth dialing: status ok, mobile first, then listed order. */
export function dialablePhones(phones: PhoneRow[]): PhoneRow[] {
  const mobile = (p: PhoneRow) => (p.line_type?.toLowerCase() === 'mobile' ? 0 : 1);
  return phones
    .filter((p) => p.status === 'ok')
    .sort((a, b) => mobile(a) - mobile(b) || a.position - b.position);
}

/** Guardrail reasons that make one phone permanently uncallable (as opposed to lead- or time-level blocks). */
const PHONE_LEVEL: ReadonlySet<BlockReason> = new Set(['internal_dnc', 'vendor_dnc', 'unscrubbed', 'scrub_stale', 'phone_dead']);

export type DialContext = {
  batches: ImportBatchRow[];
  dncNumbers: readonly string[];
  /** Numbers vendor-flagged do_not_call on any phones row: blocked on every lead. */
  vendorDncNumbers: readonly string[];
  settings: SettingsRow;
  now: Date;
};

/** Dialable phones that the phone-level guardrails would not block, in call order. */
export function callablePhones(lead: LeadRow, phones: PhoneRow[], ctx: DialContext): PhoneRow[] {
  const dnc = new Set(ctx.dncNumbers);
  const vendorDnc = new Set(ctx.vendorDncNumbers);
  return dialablePhones(phones).filter((phone) => {
    const decision = checkDial({
      lead,
      phone,
      batch: ctx.batches.find((b) => b.id === phone.batch_id) ?? null,
      internalDnc: dnc.has(phone.number),
      vendorDncElsewhere: vendorDnc.has(phone.number),
      settings: ctx.settings,
      now: ctx.now,
    });
    return decision.ok || !PHONE_LEVEL.has(decision.reason);
  });
}

/** Whether a callable phone follows `currentPhoneId` in call order; false if that phone is not in the order. */
export function hasNextCallablePhone(lead: LeadRow, phones: PhoneRow[], currentPhoneId: string, ctx: DialContext): boolean {
  const order = dialablePhones(phones);
  const at = order.findIndex((p) => p.id === currentPhoneId);
  if (at < 0) return false;
  const callable = new Set(callablePhones(lead, order, ctx).map((p) => p.id));
  return order.slice(at + 1).some((p) => callable.has(p.id));
}

export const currentLead = (s: FlowState): FlowLead | null => s.queue[0] ?? null;
export const currentPhone = (s: FlowState): PhoneRow | null => currentLead(s)?.phones[s.phoneIndex] ?? null;

/**
 * The server answered next_phone (so it left the visit open) but this client has no
 * phone after the current one: the lead moves on, so the caller must close the round.
 */
export function savedLeavesRoundOpen(s: FlowState, advance: Advance): boolean {
  const lead = currentLead(s);
  return advance === 'next_phone' && !!lead && s.phoneIndex + 1 >= lead.phones.length;
}

export const canDial = (s: FlowState) => s.callState === 'idle' && currentPhone(s) !== null;
/** An outcome needs a server-side call row to attach to. */
export const canSaveOutcome = (s: FlowState) =>
  s.callId !== null && (s.callState === 'in_call' || s.callState === 'ended');
/** Skipping never logs an outcome, so it is only allowed when nothing is left unsaved. */
export const canSkip = (s: FlowState) =>
  currentLead(s) !== null && (s.callState === 'idle' || (s.callState === 'ended' && s.callId === null));

const nextLead = (s: FlowState): FlowState => ({
  queue: s.queue.slice(1),
  phoneIndex: 0,
  callState: 'idle',
  callId: null,
});

export function flowReducer(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case 'load':
      return { ...initialFlow, queue: a.queue };
    case 'dial':
      return canDial(s) ? { ...s, callState: 'dialing', callId: null } : s;
    case 'accepted':
      return s.callState === 'dialing' ? { ...s, callState: 'in_call' } : s;
    case 'call_id':
      return s.callState === 'idle' ? s : { ...s, callId: a.callId };
    case 'disconnected':
      return s.callState === 'dialing' || s.callState === 'in_call' ? { ...s, callState: 'ended' } : s;
    case 'saved': {
      if (!canSaveOutcome(s)) return s;
      const lead = currentLead(s);
      if (a.advance === 'next_phone' && lead && s.phoneIndex + 1 < lead.phones.length) {
        return { ...s, phoneIndex: s.phoneIndex + 1, callState: 'idle', callId: null };
      }
      return nextLead(s);
    }
    case 'skip':
      return canSkip(s) ? nextLead(s) : s;
    case 'lead_closed':
      return currentLead(s) ? nextLead(s) : s;
  }
}

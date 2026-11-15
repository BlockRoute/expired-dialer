import { easternParts } from './time';
import type { ImportBatchRow, LeadRow, PhoneRow, SettingsRow } from './db/types';

export type BlockReason =
  | 'vendor_dnc' | 'internal_dnc' | 'unscrubbed' | 'scrub_stale' | 'outside_hours'
  | 'out_of_state' | 'lead_closed' | 'phone_dead' | 'cooldown' | 'max_rounds';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const HARD_OPEN_S = 8 * 3600;
const HARD_CLOSE_S = 21 * 3600;
const MAX_SCRUB_AGE_DAYS = 90;

const toSeconds = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
};
const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export function checkDial(input: {
  lead: LeadRow;
  phone: PhoneRow;
  batch: ImportBatchRow | null;
  internalDnc: boolean;
  settings: SettingsRow;
  now: Date;
}): { ok: true } | { ok: false; reason: BlockReason } {
  const { lead, phone, batch, internalDnc, settings, now } = input;
  const block = (reason: BlockReason) => ({ ok: false as const, reason });
  const east = easternParts(now);

  if (internalDnc) return block('internal_dnc');
  if (phone.vendor_dnc === 'do_not_call') return block('vendor_dnc');
  if (!batch || (phone.vendor_dnc === 'unknown' && !batch.scrubbed_by_vendor)) return block('unscrubbed');
  if (dayNumber(east.date) - dayNumber(batch.scrub_date) > MAX_SCRUB_AGE_DAYS) return block('scrub_stale');
  if (lead.status === 'out_of_state') return block('out_of_state');
  if (lead.status === 'dnc' || lead.status === 'dead' || lead.status === 'appointment') return block('lead_closed');
  if (phone.status !== 'ok') return block('phone_dead');
  if (lead.attempt_rounds >= settings.max_rounds) return block('max_rounds');
  if (lead.next_eligible_at && new Date(lead.next_eligible_at).getTime() > now.getTime()) return block('cooldown');

  const window = settings.hours[DAYS[east.weekday]];
  if (!window) return block('outside_hours');
  // Eastern offsets are whole minutes, so UTC seconds equal Eastern seconds.
  const nowS = east.minutes * 60 + now.getUTCSeconds();
  const open = Math.max(toSeconds(window[0]), HARD_OPEN_S);
  const lastStart = Math.min(toSeconds(window[1]), HARD_CLOSE_S) - settings.ring_timeout_s;
  if (nowS < open || nowS > lastStart) return block('outside_hours');

  return { ok: true };
}

export function afterRound(
  lead: LeadRow,
  settings: SettingsRow,
  now: Date,
): Pick<LeadRow, 'attempt_rounds' | 'next_eligible_at' | 'status'> {
  const attempt_rounds = lead.attempt_rounds + 1;
  return {
    attempt_rounds,
    next_eligible_at: new Date(now.getTime() + settings.round_gap_hours * 3_600_000).toISOString(),
    status: attempt_rounds >= settings.max_rounds ? 'dead' : lead.status,
  };
}

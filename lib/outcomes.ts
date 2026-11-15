import { afterRound } from './guardrails';
import type { LeadRow, PhoneRow, SettingsRow } from './db/types';

export type Advance = 'next_phone' | 'next_lead';

export type OutcomeEffects = {
  lead: Partial<LeadRow>;
  phone?: Partial<PhoneRow>;
  addInternalDnc?: string;
  callback?: { due_at: string };
  advance: Advance;
};

const KILLS_LEAD = new Set(['not_interested', 'relisted_elsewhere', 'off_market_or_sold']);
const ENDS_ROUND = new Set(['left_vm', 'connected', ...KILLS_LEAD]);

/**
 * Maps a saved call outcome to its effects on the lead and phone.
 * `hasNextPhone` is whether another dialable phone follows this one for the lead.
 * Phone-level outcomes (no answer, bad number, wrong person) close the round
 * when no phone remains.
 */
export function applyOutcome(input: {
  outcome: string;
  lead: LeadRow;
  phone: PhoneRow;
  hasNextPhone: boolean;
  settings: SettingsRow;
  now: Date;
  callbackAt?: string;
}): OutcomeEffects {
  const { outcome, lead, phone, hasNextPhone, settings, now, callbackAt } = input;

  const endRound = (): Partial<LeadRow> => {
    const next = afterRound(lead, settings, now);
    // A lead that has been worked (or whose callback was serviced) is "working".
    if (next.status === 'new' || next.status === 'callback') next.status = 'working';
    return next;
  };
  const phoneLevel = (phonePatch?: Partial<PhoneRow>): OutcomeEffects =>
    hasNextPhone
      ? { lead: {}, phone: phonePatch, advance: 'next_phone' }
      : { lead: endRound(), phone: phonePatch, advance: 'next_lead' };

  if (outcome === 'no_answer') return phoneLevel();
  if (outcome === 'bad_number') return phoneLevel({ status: 'dead' });
  if (outcome === 'wrong_person') return phoneLevel({ status: 'wrong' });
  if (outcome === 'dnc') {
    return { lead: { status: 'dnc' }, addInternalDnc: phone.number, advance: 'next_lead' };
  }
  if (outcome === 'appointment_set') return { lead: { status: 'appointment' }, advance: 'next_lead' };
  if (outcome === 'callback_requested') {
    const due = callbackAt ? new Date(callbackAt) : null;
    if (!due || Number.isNaN(due.getTime()) || due.getTime() <= now.getTime()) {
      throw new Error('A callback time in the future is required');
    }
    const due_at = due.toISOString();
    return {
      lead: { status: 'callback', next_eligible_at: due_at },
      callback: { due_at },
      advance: 'next_lead',
    };
  }
  if (ENDS_ROUND.has(outcome)) {
    const patch = endRound();
    if (KILLS_LEAD.has(outcome)) patch.status = 'dead';
    return { lead: patch, advance: 'next_lead' };
  }
  throw new Error(`Unknown outcome: ${outcome}`);
}

/** The six outcomes on the dialer's bar, in order; keys 1-6 map to these. */
export const PRIMARY_OUTCOMES = ['connected', 'no_answer', 'left_vm', 'bad_number', 'wrong_person', 'dnc'] as const;

const LABELS: Record<string, string> = {
  connected: 'Connected',
  no_answer: 'No answer',
  left_vm: 'Left VM',
  bad_number: 'Bad #',
  wrong_person: 'Wrong person',
  dnc: 'DNC',
  appointment_set: 'Appointment set',
  callback_requested: 'Callback requested',
  not_interested: 'Not interested',
  relisted_elsewhere: 'Relisted elsewhere',
  off_market_or_sold: 'Off market / sold',
};

export const outcomeLabel = (outcome: string) =>
  LABELS[outcome] ?? outcome.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

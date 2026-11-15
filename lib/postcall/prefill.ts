import type { JevAnswers } from '../typesafe/client';

export type Prefill = { outcome: string | null; openCallbackPicker: boolean; dncSuggested: boolean };

export const MAX_TRANSCRIPT_CHARS = 12_000;
const THRESHOLD = 0.5;

// Criteria text is copied from the E2 OUTCOMES in experiments/typesafe/run.py,
// with do_not_call -> dnc and voicemail_or_machine -> left_vm to match settings.outcomes.
export const OUTCOME_CRITERIA: Record<string, string> = {
  appointment_set: 'A specific meeting or listing appointment was agreed.',
  callback_requested: 'The owner agreed to talk again later; no appointment yet.',
  not_interested: 'The owner declined and the call ended without a next step.',
  dnc: 'The owner asked not to be called again.',
  relisted_elsewhere: 'The owner has relisted or is relisting with another agent.',
  off_market_or_sold: 'The home sold, was rented, or was taken off the market for good.',
  wrong_person: 'The person reached is not the owner and cannot speak for the owner.',
  left_vm: 'An answering machine or voicemail greeting; no live conversation.',
};

type SegmentLike = { speaker: 'rep' | 'owner'; text: string; t_start: number | string | null };

export const hasOwnerSpeech = (rows: SegmentLike[]) =>
  rows.some((r) => r.speaker === 'owner' && r.text.trim() !== '');

/** `Rep:`/`Owner:` lines in t_start order, keeping only the last MAX_TRANSCRIPT_CHARS characters (whole lines). */
export function formatCallTranscript(rows: SegmentLike[]): string {
  const lines = rows
    .map((r, i) => ({ r, i, t: r.t_start == null ? Number.POSITIVE_INFINITY : Number(r.t_start) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ r }) => `${r.speaker === 'rep' ? 'Rep' : 'Owner'}: ${r.text.trim()}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const add = lines[i].length + (kept.length ? 1 : 0);
    if (size + add > MAX_TRANSCRIPT_CHARS) break;
    kept.unshift(lines[i]);
    size += add;
  }
  return kept.join('\n');
}

const noul = (a: JevAnswers, key: string) => {
  const v = a[key];
  return v?.type === 'noul' ? v.noul : 0;
};

/**
 * Turns the post-call Jev answers into a suggestion. DNC (>=0.5) wins; then an
 * agreed appointment; otherwise the Choice. A key not in `allowed` is dropped.
 */
export function prefillFromAnswers(a: JevAnswers, allowed?: readonly string[]): Prefill {
  const dncSuggested = noul(a, 'dnc') >= THRESHOLD;
  const choice = a.outcome?.type === 'choice' ? a.outcome.choice : null;
  let outcome = choice;
  if (dncSuggested) outcome = 'dnc';
  else if (noul(a, 'appointment') >= THRESHOLD) outcome = 'appointment_set';
  if (outcome && allowed && !allowed.includes(outcome)) outcome = null;
  return { outcome, openCallbackPicker: noul(a, 'callback_time') >= THRESHOLD, dncSuggested };
}

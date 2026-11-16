import type { CoachAction, SettingsRow } from './db/types';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const OPEN_MIN = 8 * 60;
const CLOSE_MIN = 21 * 60;

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export const DAY_KEYS = DAYS;

/** Calling windows must be strict HH:MM inside the 08:00-21:00 hard bound; null = closed; every day present. */
export function validateHours(hours: unknown): Result {
  if (typeof hours !== 'object' || hours === null || Array.isArray(hours)) return fail('Hours are missing.');
  const h = hours as Record<string, unknown>;
  for (const day of DAYS) {
    if (!(day in h)) return fail(`Hours for ${day} are missing.`);
    const w = h[day];
    if (w === null) continue;
    if (!Array.isArray(w) || w.length !== 2) return fail(`${day}: window must be [open, close] or closed.`);
    const [open, close] = w;
    if (typeof open !== 'string' || !HHMM.test(open) || typeof close !== 'string' || !HHMM.test(close)) {
      return fail(`${day}: times must be HH:MM (for example 09:00).`);
    }
    if (minutes(open) < OPEN_MIN) return fail(`${day}: calls cannot start before 08:00.`);
    if (minutes(close) > CLOSE_MIN) return fail(`${day}: calls cannot run past 21:00.`);
    if (minutes(close) <= minutes(open)) return fail(`${day}: closing time must be after opening time.`);
  }
  return { ok: true };
}

export const RING_OPTIONS = [20, 25, 30, 45] as const;

export function validateRetry(r: { max_rounds: number; round_gap_hours: number; ring_timeout_s: number }): Result {
  const int = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!int(r.max_rounds, 1, 5)) return fail('Rounds must be 1 to 5.');
  if (!int(r.round_gap_hours, 1, 48)) return fail('Gap between rounds must be 1 to 48 hours.');
  if (!(RING_OPTIONS as readonly number[]).includes(r.ring_timeout_s)) return fail('Ring timeout must be 20, 25, 30 or 45 seconds.');
  return { ok: true };
}

/** The 11 outcome keys that drive applyOutcome, in dialer order. Keys cannot be renamed. */
export const ALL_OUTCOMES = [
  'connected', 'no_answer', 'left_vm', 'bad_number', 'wrong_person', 'dnc',
  'appointment_set', 'callback_requested', 'not_interested', 'relisted_elsewhere', 'off_market_or_sold',
] as const;

/** Enable/disable only: known keys, canonical order, `dnc` always on. */
export function normalizeOutcomes(list: string[]): { ok: true; outcomes: string[] } | { ok: false; error: string } {
  const known = new Set<string>(ALL_OUTCOMES);
  if (list.some((o) => !known.has(o))) return fail('Unknown outcome.');
  if (!list.includes('dnc')) return fail('The DNC outcome cannot be disabled.');
  const on = new Set(list);
  return { ok: true, outcomes: ALL_OUTCOMES.filter((o) => on.has(o)) };
}

export const COMPLIANCE_NOTE =
  'Calling rules support your process; you remain responsible for compliance. Not legal advice.';

/** Playbook card keys are immutable slugs; `none` is reserved for the no-card choice. */
export function validateCardKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{0,39}$/.test(key) && key !== 'none';
}

export type OverriddenRow = { key: string; shows: number; switched: number; dismissed: number; rate: number };

/** Cards with the highest switched+dismissed rate; needs at least 5 shows. Caller supplies the 30-day window. */
export function mostOverridden(
  rows: { card_key: string; action: CoachAction | null }[],
  minShows = 5,
): OverriddenRow[] {
  const by = new Map<string, OverriddenRow>();
  for (const r of rows) {
    const e = by.get(r.card_key) ?? { key: r.card_key, shows: 0, switched: 0, dismissed: 0, rate: 0 };
    e.shows++;
    if (r.action === 'switched') e.switched++;
    if (r.action === 'dismissed') e.dismissed++;
    by.set(r.card_key, e);
  }
  return [...by.values()]
    .filter((e) => e.shows >= minShows)
    .map((e) => ({ ...e, rate: (e.switched + e.dismissed) / e.shows }))
    .sort((a, b) => b.rate - a.rate || b.shows - a.shows);
}

export function topProbabilities(probs: Record<string, number>, n = 3): { key: string; p: number }[] {
  return Object.entries(probs)
    .map(([key, p]) => ({ key, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, n);
}

/** Warns when `candidate` is the runner-up above 0.3 on a test line meant for a different card. */
export function overlapWarning(probs: Record<string, number>, intendedKey: string, candidateKey: string): string | null {
  if (intendedKey === candidateKey) return null;
  const sorted = topProbabilities(probs, 2);
  const second = sorted[1];
  if (second && second.key === candidateKey && second.p > 0.3) {
    return `Overlap: "${candidateKey}" is the runner-up (${second.p.toFixed(2)}) on a line meant for "${intendedKey}". Tighten the criteria.`;
  }
  return null;
}

export type SettingsPatch = Pick<SettingsRow, 'caller_id' | 'hours' | 'max_rounds' | 'round_gap_hours' | 'ring_timeout_s' | 'outcomes'>;

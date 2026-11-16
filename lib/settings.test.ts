import { describe, expect, it } from 'vitest';
import {
  ALL_OUTCOMES,
  mostOverridden,
  normalizeOutcomes,
  overlapWarning,
  topProbabilities,
  validateCardKey,
  validateHours,
  validateRetry,
} from './settings';

const week = (w: [string, string] | null) => ({ mon: w, tue: w, wed: w, thu: w, fri: w, sat: w, sun: null });

describe('validateHours', () => {
  it('rejects a window starting before 08:00', () => {
    expect(validateHours(week(['07:30', '20:00'])).ok).toBe(false);
  });
  it('rejects a window ending after 21:00', () => {
    expect(validateHours(week(['09:00', '21:30'])).ok).toBe(false);
  });
  it('rejects end <= start', () => {
    expect(validateHours(week(['10:00', '09:00'])).ok).toBe(false);
    expect(validateHours(week(['10:00', '10:00'])).ok).toBe(false);
  });
  it('accepts 08:00-21:00 and closed days', () => {
    expect(validateHours(week(['08:00', '21:00']))).toEqual({ ok: true });
    expect(validateHours(week(null))).toEqual({ ok: true });
  });
  it("rejects non-strict HH:MM such as '9:00'", () => {
    expect(validateHours(week(['9:00', '20:00'])).ok).toBe(false);
    expect(validateHours(week(['09:00', '20:5'])).ok).toBe(false);
    expect(validateHours(week(['09:60', '20:00'])).ok).toBe(false);
    expect(validateHours(week(['24:00', '20:00'])).ok).toBe(false);
  });
  it('rejects a missing day key', () => {
    const full: Record<string, unknown> = week(['09:00', '20:00']);
    delete full.sat;
    expect(validateHours(full).ok).toBe(false);
  });
  it('rejects malformed shapes', () => {
    expect(validateHours(null).ok).toBe(false);
    expect(validateHours({ ...week(['09:00', '20:00']), mon: ['09:00'] }).ok).toBe(false);
    expect(validateHours({ ...week(['09:00', '20:00']), mon: 5 }).ok).toBe(false);
  });
});

describe('validateRetry', () => {
  const ok = { max_rounds: 3, round_gap_hours: 24, ring_timeout_s: 25 };
  it('accepts in-range values', () => {
    expect(validateRetry(ok)).toEqual({ ok: true });
    expect(validateRetry({ max_rounds: 1, round_gap_hours: 48, ring_timeout_s: 45 })).toEqual({ ok: true });
  });
  it('rejects out-of-range and non-integer values', () => {
    expect(validateRetry({ ...ok, max_rounds: 0 }).ok).toBe(false);
    expect(validateRetry({ ...ok, max_rounds: 6 }).ok).toBe(false);
    expect(validateRetry({ ...ok, round_gap_hours: 49 }).ok).toBe(false);
    expect(validateRetry({ ...ok, round_gap_hours: 0.5 }).ok).toBe(false);
    expect(validateRetry({ ...ok, ring_timeout_s: 35 }).ok).toBe(false);
  });
});

describe('normalizeOutcomes', () => {
  it('keeps canonical order and dedupes', () => {
    const r = normalizeOutcomes(['dnc', 'connected', 'connected']);
    expect(r).toEqual({ ok: true, outcomes: ['connected', 'dnc'] });
  });
  it('rejects a list without dnc', () => {
    expect(normalizeOutcomes(ALL_OUTCOMES.filter((o) => o !== 'dnc')).ok).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(normalizeOutcomes([...ALL_OUTCOMES, 'made_up']).ok).toBe(false);
  });
});

describe('validateCardKey', () => {
  it('accepts slugs', () => {
    expect(validateCardKey('price_objection_2')).toBe(true);
  });
  it('rejects bad slugs and the reserved none key', () => {
    for (const k of ['', 'Price', 'a b', '1abc', 'a-b', 'none', 'x'.repeat(41)]) expect(validateCardKey(k)).toBe(false);
  });
});

describe('mostOverridden', () => {
  const rows = (key: string, shown: number, switched: number, dismissed: number) => [
    ...Array.from({ length: switched }, () => ({ card_key: key, action: 'switched' as const })),
    ...Array.from({ length: dismissed }, () => ({ card_key: key, action: 'dismissed' as const })),
    ...Array.from({ length: shown - switched - dismissed }, () => ({ card_key: key, action: 'used' as const })),
  ];
  it('requires at least 5 shows and sorts by switched+dismissed rate', () => {
    const out = mostOverridden([...rows('a', 10, 2, 1), ...rows('b', 4, 4, 0), ...rows('c', 5, 3, 1), ...rows('d', 6, 0, 0)]);
    expect(out.map((r) => r.key)).toEqual(['c', 'a', 'd']);
    expect(out[0]).toMatchObject({ shows: 5, switched: 3, dismissed: 1, rate: 0.8 });
  });
  it('counts null actions as shows only', () => {
    const out = mostOverridden(Array.from({ length: 5 }, () => ({ card_key: 'x', action: null })));
    expect(out[0]).toMatchObject({ shows: 5, rate: 0 });
  });
});

describe('topProbabilities / overlapWarning', () => {
  const probs = { a: 0.5, b: 0.35, none: 0.1, c: 0.05 };
  it('returns the top three descending', () => {
    expect(topProbabilities(probs).map((p) => p.key)).toEqual(['a', 'b', 'none']);
  });
  it('warns when the candidate is runner-up above 0.3 on another card line', () => {
    expect(overlapWarning(probs, 'a', 'b')).toMatch(/b/);
  });
  it('does not warn when the line was meant for the candidate, it is below 0.3, or it is not runner-up', () => {
    expect(overlapWarning(probs, 'b', 'b')).toBeNull();
    expect(overlapWarning({ a: 0.7, b: 0.25, c: 0.05 }, 'a', 'b')).toBeNull();
    expect(overlapWarning({ a: 0.5, c: 0.35, b: 0.31 }, 'a', 'b')).toBeNull();
  });
});

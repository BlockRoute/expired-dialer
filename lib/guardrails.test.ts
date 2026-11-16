import { describe, it, expect } from 'vitest';
import { checkDial, afterRound } from './guardrails';
import type { ImportBatchRow, LeadRow, PhoneRow, SettingsRow } from './db/types';

const lead = (o: Partial<LeadRow> = {}): LeadRow =>
  ({ id: 'l1', status: 'new', attempt_rounds: 0, next_eligible_at: null, expired_date: null, ...o }) as LeadRow;
const phone = (o: Partial<PhoneRow> = {}): PhoneRow =>
  ({ id: 'p1', lead_id: 'l1', number: '+18045550100', vendor_dnc: 'callable', status: 'ok', batch_id: 'b1', ...o }) as PhoneRow;
const batch = (o: Partial<ImportBatchRow> = {}): ImportBatchRow =>
  ({ id: 'b1', scrub_date: '2026-11-01', scrubbed_by_vendor: true, ...o }) as ImportBatchRow;
const win = (w: [string, string] | null) =>
  ({ mon: w, tue: w, wed: w, thu: w, fri: w, sat: w, sun: w });
const settings = (o: Partial<SettingsRow> = {}): SettingsRow =>
  ({ id: 1, hours: win(['09:00', '21:00']), max_rounds: 3, round_gap_hours: 24, ring_timeout_s: 25, ...o }) as SettingsRow;

// Eastern (EST, UTC-5, November 2026) wall-clock -> instant. 2026-11-16 is a Monday.
const et = (day: string, hms: string) => new Date(`${day}T${hms}-05:00`);
const NOW = et('2026-11-16', '12:00:00');
const base = { lead: lead(), phone: phone(), batch: batch(), internalDnc: false, vendorDncElsewhere: false, settings: settings(), now: NOW };

describe('checkDial list checks', () => {
  it('ok baseline', () => expect(checkDial(base)).toEqual({ ok: true }));
  it('internal DNC beats everything', () => {
    const r = checkDial({ ...base, internalDnc: true, phone: phone({ vendor_dnc: 'do_not_call' }), lead: lead({ status: 'dead' }) });
    expect(r).toEqual({ ok: false, reason: 'internal_dnc' });
  });
  it('vendor do_not_call blocked', () =>
    expect(checkDial({ ...base, phone: phone({ vendor_dnc: 'do_not_call' }) })).toEqual({ ok: false, reason: 'vendor_dnc' }));
  it('unknown + unscrubbed batch', () =>
    expect(checkDial({ ...base, phone: phone({ vendor_dnc: 'unknown' }), batch: batch({ scrubbed_by_vendor: false }) })).toEqual({ ok: false, reason: 'unscrubbed' }));
  it('null batch blocks as unscrubbed', () =>
    expect(checkDial({ ...base, batch: null })).toEqual({ ok: false, reason: 'unscrubbed' }));
  it('unknown + scrubbed 30 days old ok', () =>
    expect(checkDial({ ...base, phone: phone({ vendor_dnc: 'unknown' }), batch: batch({ scrub_date: '2026-10-17' }) })).toEqual({ ok: true }));
  it('exactly 90 days ok, 91 stale', () => {
    expect(checkDial({ ...base, batch: batch({ scrub_date: '2026-08-18' }) })).toEqual({ ok: true });
    expect(checkDial({ ...base, batch: batch({ scrub_date: '2026-08-17' }) })).toEqual({ ok: false, reason: 'scrub_stale' });
  });
  it('stale applies to callable phones; compares Eastern dates', () => {
    // 19:30 ET Nov 16 is already Nov 17 in UTC
    const now = new Date('2026-11-17T00:30:00Z');
    expect(checkDial({ ...base, now, batch: batch({ scrub_date: '2026-08-18' }) })).toEqual({ ok: true });
  });
  it('a scrub date in the future blocks as scrub_stale (year typo)', () => {
    expect(checkDial({ ...base, batch: batch({ scrub_date: '2026-11-17' }) })).toEqual({ ok: false, reason: 'scrub_stale' });
    expect(checkDial({ ...base, batch: batch({ scrub_date: '2027-11-01' }) })).toEqual({ ok: false, reason: 'scrub_stale' });
    expect(checkDial({ ...base, batch: batch({ scrub_date: '2026-11-16' }) })).toEqual({ ok: true });
  });
  it('the same number flagged do_not_call on another lead blocks this phone', () =>
    expect(checkDial({ ...base, vendorDncElsewhere: true })).toEqual({ ok: false, reason: 'vendor_dnc' }));
  it('a lead awaiting DNC review is blocked', () =>
    expect(checkDial({ ...base, lead: lead({ dnc_review_at: '2026-11-16T16:00:00Z' }) })).toEqual({ ok: false, reason: 'dnc_review' }));
  it('lead statuses', () => {
    expect(checkDial({ ...base, lead: lead({ status: 'out_of_state' }) })).toEqual({ ok: false, reason: 'out_of_state' });
    for (const s of ['dnc', 'dead', 'appointment'] as const)
      expect(checkDial({ ...base, lead: lead({ status: s }) })).toEqual({ ok: false, reason: 'lead_closed' });
  });
  it('phone dead', () =>
    expect(checkDial({ ...base, phone: phone({ status: 'wrong' }) })).toEqual({ ok: false, reason: 'phone_dead' }));
  it('max rounds', () =>
    expect(checkDial({ ...base, lead: lead({ attempt_rounds: 3 }) })).toEqual({ ok: false, reason: 'max_rounds' }));
  it('cooldown', () =>
    expect(checkDial({ ...base, lead: lead({ next_eligible_at: '2026-11-16T18:00:00Z' }) })).toEqual({ ok: false, reason: 'cooldown' }));
  it('cooldown over when next_eligible_at <= now', () =>
    expect(checkDial({ ...base, lead: lead({ next_eligible_at: NOW.toISOString() }) })).toEqual({ ok: true }));
});

describe.each(['UTC', 'America/Los_Angeles', 'America/New_York'])('checkDial hours (TZ=%s)', (tz) => {
  const orig = process.env.TZ;
  const run = (day: string, hms: string, s = settings()) => {
    process.env.TZ = tz;
    try { return checkDial({ ...base, settings: s, now: et(day, hms) }); } finally { process.env.TZ = orig; }
  };
  const wide = settings({ hours: win(['07:00', '22:00']) });
  it('Saturday 19:59:00 ok', () => expect(run('2026-11-14', '19:59:00')).toEqual({ ok: true }));
  it('Sunday closed', () => expect(run('2026-11-15', '12:00:00', settings({ hours: { ...win(['09:00', '21:00']), sun: null } }))).toEqual({ ok: false, reason: 'outside_hours' }));
  it('wide window still blocks 07:30 and 20:59:40', () => {
    expect(run('2026-11-16', '07:30:00', wide)).toEqual({ ok: false, reason: 'outside_hours' });
    expect(run('2026-11-16', '20:59:40', wide)).toEqual({ ok: false, reason: 'outside_hours' });
    expect(run('2026-11-16', '08:00:00', wide)).toEqual({ ok: true });
  });
  it('last start 20:59:35 with 25s ring', () => {
    expect(run('2026-11-16', '20:59:34')).toEqual({ ok: true });
    expect(run('2026-11-16', '20:59:35')).toEqual({ ok: true });
    expect(run('2026-11-16', '20:59:36')).toEqual({ ok: false, reason: 'outside_hours' });
  });
  it('before window start blocks', () => expect(run('2026-11-16', '08:59:59')).toEqual({ ok: false, reason: 'outside_hours' }));
});

describe('checkDial fails closed on malformed input', () => {
  const hrs = (w: unknown) => settings({ hours: win(w as never) });
  it('garbage hours strings cannot bypass the hard bound', () => {
    for (const w of [['x', 'y'], ['', ''], ['09:00', '9pm'], ['25:00', '99:99']]) {
      expect(checkDial({ ...base, settings: hrs(w), now: et('2026-11-16', '03:00:00') })).toEqual({ ok: false, reason: 'outside_hours' });
      expect(checkDial({ ...base, settings: hrs(w), now: et('2026-11-16', '21:30:00') })).toEqual({ ok: false, reason: 'outside_hours' });
      expect(checkDial({ ...base, settings: hrs(w), now: et('2026-11-16', '12:00:00') })).toEqual({ ok: false, reason: 'outside_hours' });
    }
  });
  it('negative or non-finite ring_timeout_s blocks', () => {
    for (const r of [-3600, NaN, undefined, Infinity])
      expect(checkDial({ ...base, settings: settings({ ring_timeout_s: r as never }), now: et('2026-11-16', '21:30:00') })).toEqual({ ok: false, reason: 'outside_hours' });
    expect(checkDial({ ...base, settings: settings({ ring_timeout_s: -3600 }) })).toEqual({ ok: false, reason: 'outside_hours' });
  });
  it('unparseable scrub_date -> scrub_stale', () =>
    expect(checkDial({ ...base, batch: batch({ scrub_date: 'garbage' }) })).toEqual({ ok: false, reason: 'scrub_stale' }));
  it('unparseable next_eligible_at -> cooldown', () =>
    expect(checkDial({ ...base, lead: lead({ next_eligible_at: 'nope' }) })).toEqual({ ok: false, reason: 'cooldown' }));
  it('non-finite attempt_rounds or max_rounds -> max_rounds', () => {
    expect(checkDial({ ...base, lead: lead({ attempt_rounds: NaN }) })).toEqual({ ok: false, reason: 'max_rounds' });
    expect(checkDial({ ...base, settings: settings({ max_rounds: NaN }) })).toEqual({ ok: false, reason: 'max_rounds' });
  });
});

describe('afterRound', () => {
  it('increments and schedules gap', () => {
    const r = afterRound(lead({ attempt_rounds: 0 }), settings(), NOW);
    expect(r.attempt_rounds).toBe(1);
    expect(r.status).toBe('new');
    expect(r.next_eligible_at).toBe(new Date(NOW.getTime() + 24 * 3600_000).toISOString());
  });
  it('rounds=2, max 3 -> dead', () => expect(afterRound(lead({ attempt_rounds: 2 }), settings(), NOW).status).toBe('dead'));
});

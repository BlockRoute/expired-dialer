import { describe, it, expect } from 'vitest';
import { applyOutcome, closeRoundPatch } from './outcomes';
import type { LeadRow, PhoneRow, SettingsRow } from './db/types';

const NOW = new Date('2026-11-16T17:00:00Z');
const lead = (o: Partial<LeadRow> = {}) =>
  ({ id: 'L1', status: 'new', attempt_rounds: 0, next_eligible_at: null, ...o }) as LeadRow;
const phone = (o: Partial<PhoneRow> = {}) =>
  ({ id: 'P1', lead_id: 'L1', number: '+18045550142', status: 'ok', ...o }) as PhoneRow;
const settings = { max_rounds: 3, round_gap_hours: 24 } as SettingsRow;
const run = (outcome: string, o: { lead?: Partial<LeadRow>; hasNextPhone?: boolean; callbackAt?: string } = {}) =>
  applyOutcome({
    outcome,
    lead: lead(o.lead),
    phone: phone(),
    hasNextPhone: o.hasNextPhone ?? false,
    settings,
    now: NOW,
    callbackAt: o.callbackAt,
  });
const NEXT_ELIGIBLE = '2026-11-17T17:00:00.000Z';

describe('applyOutcome', () => {
  it('no_answer with phones remaining advances to the next phone and leaves the lead alone', () => {
    const r = run('no_answer', { hasNextPhone: true });
    expect(r.advance).toBe('next_phone');
    expect(r.lead).toEqual({});
    expect(r.phone).toBeUndefined();
  });

  it('no_answer on the last phone closes the round and moves to the next lead', () => {
    const r = run('no_answer', { lead: { attempt_rounds: 1 } });
    expect(r.advance).toBe('next_lead');
    expect(r.lead).toEqual({ attempt_rounds: 2, next_eligible_at: NEXT_ELIGIBLE, status: 'working' });
  });

  it('the round that reaches max_rounds kills the lead', () => {
    const r = run('no_answer', { lead: { attempt_rounds: 2, status: 'working' } });
    expect(r.lead).toEqual({ attempt_rounds: 3, next_eligible_at: NEXT_ELIGIBLE, status: 'dead' });
  });

  it('bad_number marks the phone dead and advances to the next phone', () => {
    const r = run('bad_number', { hasNextPhone: true });
    expect(r.phone).toEqual({ status: 'dead' });
    expect(r.advance).toBe('next_phone');
    expect(r.lead).toEqual({});
  });

  it('wrong_person marks the phone wrong and advances to the next phone', () => {
    const r = run('wrong_person', { hasNextPhone: true });
    expect(r.phone).toEqual({ status: 'wrong' });
    expect(r.advance).toBe('next_phone');
  });

  it('bad_number on the last phone still marks the phone and closes the round', () => {
    const r = run('bad_number');
    expect(r.phone).toEqual({ status: 'dead' });
    expect(r.advance).toBe('next_lead');
    expect(r.lead.attempt_rounds).toBe(1);
  });

  it('dnc marks the lead dnc, adds the number to the internal list and moves on', () => {
    const r = run('dnc', { hasNextPhone: true });
    expect(r.lead).toEqual({ status: 'dnc' });
    expect(r.addInternalDnc).toBe('+18045550142');
    expect(r.advance).toBe('next_lead');
  });

  it('appointment_set marks the lead appointment and moves on', () => {
    const r = run('appointment_set', { hasNextPhone: true });
    expect(r.lead).toEqual({ status: 'appointment' });
    expect(r.advance).toBe('next_lead');
  });

  it('callback_requested marks the lead callback, makes it eligible at the callback time, and creates the callback', () => {
    const at = '2026-11-17T15:00:00.000Z';
    const r = run('callback_requested', { callbackAt: at });
    expect(r.lead).toEqual({ status: 'callback', next_eligible_at: at });
    expect(r.callback).toEqual({ due_at: at });
    expect(r.advance).toBe('next_lead');
  });

  it('callback_requested requires a valid future callback time', () => {
    expect(() => run('callback_requested')).toThrow(/callback/i);
    expect(() => run('callback_requested', { callbackAt: 'nonsense' })).toThrow(/callback/i);
    expect(() => run('callback_requested', { callbackAt: '2026-11-16T16:00:00Z' })).toThrow(/callback/i);
  });

  it.each(['left_vm', 'connected'])('%s runs afterRound and moves to the next lead', (outcome) => {
    const r = run(outcome, { hasNextPhone: true });
    expect(r.lead).toEqual({ attempt_rounds: 1, next_eligible_at: NEXT_ELIGIBLE, status: 'working' });
    expect(r.advance).toBe('next_lead');
    expect(r.callback).toBeUndefined();
  });

  it.each(['not_interested', 'relisted_elsewhere', 'off_market_or_sold'])('%s kills the lead', (outcome) => {
    const r = run(outcome, { hasNextPhone: true });
    expect(r.lead.status).toBe('dead');
    expect(r.lead.attempt_rounds).toBe(1);
    expect(r.advance).toBe('next_lead');
  });

  it('a serviced callback lead goes back to working after a round', () => {
    const r = run('connected', { lead: { status: 'callback', attempt_rounds: 1 } });
    expect(r.lead.status).toBe('working');
  });

  it('rejects an unknown outcome', () => {
    expect(() => run('banana')).toThrow(/unknown outcome/i);
  });

  describe('closed leads', () => {
    it.each(['dnc', 'dead', 'appointment', 'out_of_state'] as const)('a %s lead keeps its status and gets no callback', (status) => {
      const at = '2026-11-17T15:00:00.000Z';
      expect(run('callback_requested', { lead: { status }, callbackAt: at })).toMatchObject({ lead: {}, callback: undefined });
      expect(run('appointment_set', { lead: { status } }).lead).toEqual({});
      expect(run('connected', { lead: { status, attempt_rounds: 2 } }).lead).toEqual({});
      expect(run('no_answer', { lead: { status, attempt_rounds: 2 } }).lead).toEqual({});
    });

    it('still records phone effects and lets DNC escalate a closed lead', () => {
      const r = run('dnc', { lead: { status: 'dead' } });
      expect(r.lead).toEqual({ status: 'dnc' });
      expect(r.addInternalDnc).toBe('+18045550142');
      expect(run('bad_number', { lead: { status: 'dnc' }, hasNextPhone: true }).phone).toEqual({ status: 'dead' });
    });
  });

  describe('closeRoundPatch (skipping a lead mid-visit)', () => {
    it('counts the round and sets the cooldown', () => {
      expect(closeRoundPatch(lead({ attempt_rounds: 1 }), settings, NOW)).toEqual({
        attempt_rounds: 2, next_eligible_at: NEXT_ELIGIBLE, status: 'working',
      });
    });
    it('leaves closed leads alone', () => {
      expect(closeRoundPatch(lead({ status: 'dnc' }), settings, NOW)).toEqual({});
    });
  });
});

import { describe, it, expect } from 'vitest';
import { applyOutcome } from '../outcomes';
import { callablePhones, hasNextCallablePhone, savedLeavesRoundOpen, currentLead, currentPhone, dialablePhones, flowReducer, initialFlow, canDial, canSaveOutcome, canSkip, type FlowAction, type FlowLead, type FlowState } from './flow';
import type { ImportBatchRow, LeadRow, PhoneRow, SettingsRow } from '../db/types';

const NOW = new Date('2026-11-16T17:00:00Z');
const settings = { max_rounds: 3, round_gap_hours: 24 } as SettingsRow;
const mkLead = (id: string) => ({ id, status: 'new', attempt_rounds: 0, next_eligible_at: null }) as LeadRow;
const mkPhone = (id: string, lead_id: string, position: number, o: Partial<PhoneRow> = {}) =>
  ({ id, lead_id, number: `+1804555010${position}`, position, status: 'ok', line_type: null, ...o }) as PhoneRow;
const entry = (id: string, phones: PhoneRow[]): FlowLead => ({ lead: mkLead(id), phones });
const run = (state: FlowState, ...actions: FlowAction[]) => actions.reduce(flowReducer, state);

describe('dialablePhones', () => {
  it('drops dead/wrong phones and puts mobile first, then listed order', () => {
    const phones = [
      mkPhone('a', 'L', 1, { line_type: 'landline' }),
      mkPhone('b', 'L', 2, { status: 'dead' }),
      mkPhone('c', 'L', 3, { line_type: 'mobile' }),
      mkPhone('d', 'L', 4),
    ];
    expect(dialablePhones(phones).map((p) => p.id)).toEqual(['c', 'a', 'd']);
  });
});

describe('flowReducer', () => {
  const queue = () => [
    entry('L1', [mkPhone('P1', 'L1', 1), mkPhone('P2', 'L1', 2)]),
    entry('L2', [mkPhone('P3', 'L2', 1)]),
  ];
  const connected = (s: FlowState, callId: string) =>
    run(s, { type: 'dial' }, { type: 'accepted' }, { type: 'call_id', callId });

  it('starts idle on the first lead and first phone after load', () => {
    const s = run(initialFlow, { type: 'load', queue: queue() });
    expect(currentLead(s)?.lead.id).toBe('L1');
    expect(currentPhone(s)?.id).toBe('P1');
    expect(s.callState).toBe('idle');
    expect(canDial(s)).toBe(true);
  });

  it('cannot dial or save with an empty queue', () => {
    expect(canDial(initialFlow)).toBe(false);
    expect(canSaveOutcome(initialFlow)).toBe(false);
  });

  it('walks the brief: call, no answer -> phone 2, DNC -> lead leaves, next lead loads', () => {
    let s = run(initialFlow, { type: 'load', queue: queue() });

    // Call phone 1, mark no answer.
    s = connected(s, 'C1');
    expect(s.callState).toBe('in_call');
    expect(canSaveOutcome(s)).toBe(true);
    s = run(s, { type: 'disconnected' });
    expect(s.callState).toBe('ended');
    const first = applyOutcome({
      outcome: 'no_answer', lead: currentLead(s)!.lead, phone: currentPhone(s)!,
      hasNextPhone: currentLead(s)!.phones.length > s.phoneIndex + 1, leadNumbers: [], settings, now: NOW,
    });
    expect(first.advance).toBe('next_phone');
    s = run(s, { type: 'saved', advance: first.advance });
    expect(currentLead(s)?.lead.id).toBe('L1');
    expect(currentPhone(s)?.id).toBe('P2');
    expect(s.callState).toBe('idle');
    expect(s.callId).toBeNull();

    // Call phone 2, mark DNC.
    s = run(connected(s, 'C2'), { type: 'disconnected' });
    const second = applyOutcome({
      outcome: 'dnc', lead: currentLead(s)!.lead, phone: currentPhone(s)!, hasNextPhone: false,
      leadNumbers: currentLead(s)!.phones.map((p) => p.number), settings, now: NOW,
    });
    expect(second.lead.status).toBe('dnc');
    expect(second.addInternalDnc).toEqual(['+18045550102', '+18045550101']);
    s = run(s, { type: 'saved', advance: second.advance });
    expect(s.queue.map((q) => q.lead.id)).toEqual(['L2']);
    expect(currentLead(s)?.lead.id).toBe('L2');
    expect(currentPhone(s)?.id).toBe('P3');
    expect(s.phoneIndex).toBe(0);
    expect(s.callState).toBe('idle');
  });

  it('next_phone with no phone left moves to the next lead', () => {
    let s = run(initialFlow, { type: 'load', queue: [entry('L1', [mkPhone('P1', 'L1', 1)]), queue()[1]] });
    s = run(connected(s, 'C1'), { type: 'disconnected' }, { type: 'saved', advance: 'next_phone' });
    expect(currentLead(s)?.lead.id).toBe('L2');
  });

  it('running out of leads leaves an empty queue', () => {
    let s = run(initialFlow, { type: 'load', queue: [entry('L1', [mkPhone('P1', 'L1', 1)])] });
    s = run(connected(s, 'C1'), { type: 'saved', advance: 'next_lead' });
    expect(currentLead(s)).toBeNull();
    expect(canDial(s)).toBe(false);
  });

  it('a lead with no dialable phones cannot be dialed but can be skipped', () => {
    const s = run(initialFlow, { type: 'load', queue: [entry('L1', []), queue()[1]] });
    expect(canDial(s)).toBe(false);
    expect(canSkip(s)).toBe(true);
    expect(currentLead(run(s, { type: 'skip' }))?.lead.id).toBe('L2');
  });

  it('skip is ignored during a call or while an outcome is unsaved', () => {
    const s = run(initialFlow, { type: 'load', queue: queue() });
    const dialing = run(s, { type: 'dial' });
    expect(canSkip(dialing)).toBe(false);
    expect(run(dialing, { type: 'skip' })).toEqual(dialing);
    const ended = run(connected(s, 'C1'), { type: 'disconnected' });
    expect(canSkip(ended)).toBe(false);
    expect(run(ended, { type: 'skip' })).toEqual(ended);
  });

  it('a call that never connected (blocked, no call id) can be skipped once it ends', () => {
    const s = run(initialFlow, { type: 'load', queue: queue() }, { type: 'dial' }, { type: 'disconnected' });
    expect(s.callState).toBe('ended');
    expect(canSaveOutcome(s)).toBe(false);
    expect(canSkip(s)).toBe(true);
    expect(currentLead(run(s, { type: 'skip' }))?.lead.id).toBe('L2');
  });

  it('a second dial while a call is active is ignored', () => {
    const s = run(initialFlow, { type: 'load', queue: queue() }, { type: 'dial' });
    expect(run(s, { type: 'dial' })).toEqual(s);
  });

  it('saved without a call id is ignored', () => {
    const s = run(initialFlow, { type: 'load', queue: queue() });
    expect(run(s, { type: 'saved', advance: 'next_lead' })).toEqual(s);
  });
});

describe('callable phones (phone-level guardrails)', () => {
  // Scrubbed before the 'closed hours' instant below (Nov 15 ET), so only the hours differ.
  const batch = { id: 'B', scrubbed_by_vendor: true, scrub_date: '2026-11-10' } as ImportBatchRow;
  const ctx = (dnc: string[] = [], vendorDnc: string[] = []) => ({ batches: [batch], dncNumbers: dnc, vendorDncNumbers: vendorDnc, settings, now: NOW });
  const ph = (id: string, position: number, o: Partial<PhoneRow> = {}) =>
    mkPhone(id, 'L1', position, { batch_id: 'B', vendor_dnc: 'callable', ...o });
  const lead = mkLead('L1');

  it('drops vendor-flagged, internal-DNC and unscrubbed phones', () => {
    const phones = [
      ph('a', 1),
      ph('b', 2, { vendor_dnc: 'do_not_call' }),
      ph('c', 3, { number: '+18045559999' }),
      ph('d', 4, { vendor_dnc: 'unknown', batch_id: null }),
      ph('e', 5),
    ];
    expect(callablePhones(lead, phones, ctx(['+18045559999'])).map((p) => p.id)).toEqual(['a', 'e']);
  });

  it('a number flagged do_not_call on any lead is not callable here', () => {
    const phones = [ph('a', 1), ph('b', 2, { number: '+18045558888' })];
    expect(callablePhones(lead, phones, ctx([], ['+18045558888'])).map((p) => p.id)).toEqual(['a']);
  });

  it('phone 2 vendor-flagged: phone 1 is the last callable phone, so no_answer closes the round', () => {
    const phones = [ph('a', 1), ph('b', 2, { vendor_dnc: 'do_not_call' })];
    expect(hasNextCallablePhone(lead, phones, 'a', ctx())).toBe(false);
    const r = applyOutcome({
      outcome: 'no_answer', lead, phone: phones[0], hasNextPhone: hasNextCallablePhone(lead, phones, 'a', ctx()), leadNumbers: [], settings, now: NOW,
    });
    expect(r.advance).toBe('next_lead');
    expect(r.lead.attempt_rounds).toBe(1);
  });

  it('a callable phone after the current one counts; earlier ones and unknown ids do not', () => {
    const phones = [ph('a', 1), ph('b', 2)];
    expect(hasNextCallablePhone(lead, phones, 'a', ctx())).toBe(true);
    expect(hasNextCallablePhone(lead, phones, 'b', ctx())).toBe(false);
    expect(hasNextCallablePhone(lead, phones, 'zzz', ctx())).toBe(false);
  });

  it('the hours window does not make a phone uncallable', () => {
    const closed = { ...ctx(), now: new Date('2026-11-16T03:00:00Z') };
    expect(callablePhones(lead, [ph('a', 1)], closed)).toHaveLength(1);
  });
});

describe('skipping after an earlier outcome on the lead', () => {
  const q = () => [
    entry('L1', [mkPhone('P1', 'L1', 1), mkPhone('P2', 'L1', 2)]),
    entry('L2', [mkPhone('P3', 'L2', 1)]),
  ];
  it('idle on phone 2 after a next_phone outcome can be skipped', () => {
    let s = run(initialFlow, { type: 'load', queue: q() });
    s = run(s, { type: 'dial' }, { type: 'accepted' }, { type: 'call_id', callId: 'C1' }, { type: 'disconnected' }, { type: 'saved', advance: 'next_phone' });
    expect(canSkip(s)).toBe(true);
    expect(currentLead(run(s, { type: 'skip' }))?.lead.id).toBe('L2');
  });
  it('phone 2 blocked by the server (ended, no call id) can be skipped too', () => {
    let s = run(initialFlow, { type: 'load', queue: q() });
    s = run(s, { type: 'dial' }, { type: 'accepted' }, { type: 'call_id', callId: 'C1' }, { type: 'disconnected' }, { type: 'saved', advance: 'next_phone' });
    s = run(s, { type: 'dial' }, { type: 'disconnected' });
    expect(s.phoneIndex).toBe(1);
    expect(s.callState).toBe('ended');
    expect(s.callId).toBeNull();
    expect(canSkip(s)).toBe(true);
    expect(currentLead(run(s, { type: 'skip' }))?.lead.id).toBe('L2');
  });
});

describe('savedLeavesRoundOpen', () => {
  const q = () => [entry('L1', [mkPhone('P1', 'L1', 1), mkPhone('P2', 'L1', 2)]), entry('L2', [mkPhone('P3', 'L2', 1)])];
  it('next_phone with no phone left on this client: the round must be closed', () => {
    let s = run(initialFlow, { type: 'load', queue: q() });
    s = run(s, { type: 'dial' }, { type: 'accepted' }, { type: 'call_id', callId: 'C1' }, { type: 'disconnected' }, { type: 'saved', advance: 'next_phone' });
    expect(s.phoneIndex).toBe(1);
    expect(savedLeavesRoundOpen(s, 'next_phone')).toBe(true);
  });
  it('false when another phone follows, or the server closed the round (next_lead)', () => {
    const s = run(initialFlow, { type: 'load', queue: q() });
    expect(savedLeavesRoundOpen(s, 'next_phone')).toBe(false);
    expect(savedLeavesRoundOpen(s, 'next_lead')).toBe(false);
  });
});

describe('lead_closed (Mark lead DNC without a call id)', () => {
  it('moves to the next lead even when the call id never arrived', () => {
    let s = run(initialFlow, { type: 'load', queue: [entry('L1', [mkPhone('P1', 'L1', 1)]), entry('L2', [mkPhone('P3', 'L2', 1)])] });
    s = run(s, { type: 'dial' }, { type: 'accepted' }, { type: 'disconnected' });
    expect(canSaveOutcome(s)).toBe(false);
    s = run(s, { type: 'lead_closed' });
    expect(currentLead(s)?.lead.id).toBe('L2');
    expect(s).toMatchObject({ callState: 'idle', callId: null, phoneIndex: 0 });
  });
  it('a late call id from the previous lead is ignored once idle', () => {
    let s = run(initialFlow, { type: 'load', queue: [entry('L1', [mkPhone('P1', 'L1', 1)]), entry('L2', [mkPhone('P3', 'L2', 1)])] });
    s = run(s, { type: 'dial' }, { type: 'lead_closed' }, { type: 'call_id', callId: 'C-old' });
    expect(s.callId).toBeNull();
  });
});

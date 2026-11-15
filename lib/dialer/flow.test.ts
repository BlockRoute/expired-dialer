import { describe, it, expect } from 'vitest';
import { applyOutcome } from '../outcomes';
import { currentLead, currentPhone, dialablePhones, flowReducer, initialFlow, canDial, canSaveOutcome, canSkip, type FlowAction, type FlowLead, type FlowState } from './flow';
import type { LeadRow, PhoneRow, SettingsRow } from '../db/types';

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
      hasNextPhone: currentLead(s)!.phones.length > s.phoneIndex + 1, settings, now: NOW,
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
      outcome: 'dnc', lead: currentLead(s)!.lead, phone: currentPhone(s)!, hasNextPhone: false, settings, now: NOW,
    });
    expect(second.lead.status).toBe('dnc');
    expect(second.addInternalDnc).toBe('+18045550102');
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

import { describe, expect, it } from 'vitest';
import { dncAppliesToCall, resolveCoachResponse } from './panel-state';

const card = { key: 'a', title: 'A', say: 's', source: 'jev' as const };
const base = { latestTurnId: 5, currentCallId: 'c1', requestCallId: 'c1' };

describe('resolveCoachResponse', () => {
  it('shows cards for the latest turn', () => {
    const r = resolveCoachResponse({ ...base, response: { turnId: 5, cards: [card], dncP: 0.1, coachCardId: 'x' } });
    expect(r).toEqual({ reportDnc: false, view: { kind: 'cards', cards: [card], coachCardId: 'x' } });
  });
  it('stale response: cards ignored but DNC still reported', () => {
    const r = resolveCoachResponse({ ...base, response: { turnId: 3, cards: [card], dncP: 0.9 } });
    expect(r).toEqual({ reportDnc: true, view: { kind: 'ignore' } });
  });
  it('response for another call is ignored entirely', () => {
    const r = resolveCoachResponse({ ...base, currentCallId: 'c2', response: { turnId: 5, cards: [card], dncP: 0.9 } });
    expect(r).toEqual({ reportDnc: false, view: { kind: 'ignore' } });
  });
  it('response after hang-up (panel unmounted, same call) still reports DNC; cards are the panel\'s to skip', () => {
    // After unmount the panel's last-known call id is unchanged, so the request still matches it.
    const r = resolveCoachResponse({ ...base, response: { turnId: 5, cards: [], dncP: 0.97 } });
    expect(r.reportDnc).toBe(true);
    expect(dncAppliesToCall('c1', 'c1')).toBe(true); // call ended, flow.callId still c1
  });
  it('dialer drops a DNC once a different call is current', () => {
    expect(dncAppliesToCall('c1', 'c2')).toBe(false);
    expect(dncAppliesToCall('c1', null)).toBe(false);
  });
  it('paused latest turn clears cards but keeps dncP', () => {
    const r = resolveCoachResponse({ ...base, response: { turnId: 5, cards: [], dncP: 0.8, paused: true } });
    expect(r).toEqual({ reportDnc: true, view: { kind: 'paused' } });
  });
  it('failed request on a stale turn is ignored; on the latest turn it pauses', () => {
    expect(resolveCoachResponse({ ...base, response: null, turnId: 3 }).view).toEqual({ kind: 'ignore' });
    expect(resolveCoachResponse({ ...base, response: null, turnId: 5 }).view).toEqual({ kind: 'paused' });
  });
});

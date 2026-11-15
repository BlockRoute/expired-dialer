import { describe, expect, it } from 'vitest';
import { resolveCoachResponse } from './panel-state';

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
  it('paused latest turn clears cards but keeps dncP', () => {
    const r = resolveCoachResponse({ ...base, response: { turnId: 5, cards: [], dncP: 0.8, paused: true } });
    expect(r).toEqual({ reportDnc: true, view: { kind: 'paused' } });
  });
  it('failed request on a stale turn is ignored; on the latest turn it pauses', () => {
    expect(resolveCoachResponse({ ...base, response: null, turnId: 3 }).view).toEqual({ kind: 'ignore' });
    expect(resolveCoachResponse({ ...base, response: null, turnId: 5 }).view).toEqual({ kind: 'paused' });
  });
});

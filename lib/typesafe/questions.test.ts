import { describe, expect, it } from 'vitest';
import {
  appointmentNoul,
  callbackTimeNoul,
  cardChoice,
  columnFieldChoice,
  dncColumnNoul,
  dncRequestNoul,
  dncValueChoice,
  outcomeChoice,
} from './questions';
import { DEFAULT_PLAYBOOK } from '../coach/playbook-default';

describe('question builders', () => {
  it('cardChoice criteria contain every card key plus none', () => {
    const q = cardChoice(DEFAULT_PLAYBOOK, true);
    expect(q.type).toBe('choice');
    if (q.type !== 'choice') throw new Error();
    for (const c of DEFAULT_PLAYBOOK) expect(q.criteria).toHaveProperty(c.key);
    expect(q.criteria).toHaveProperty('none');
    expect(q.instructions).toContain('transcript_so_far');
  });

  it('cardChoice without context omits transcript_so_far', () => {
    const q = cardChoice(DEFAULT_PLAYBOOK, false);
    expect(q.instructions).not.toContain('transcript_so_far');
  });

  it('cardChoice skips cards with null criteria', () => {
    const q = cardChoice([{ key: 'a', criteria: null }, { key: 'b', criteria: 'B' }], false);
    if (q.type !== 'choice') throw new Error();
    expect(Object.keys(q.criteria)).toEqual(['b', 'none']);
  });

  it('dncRequestNoul(transcript) names `transcript` and the later-time carve-out', () => {
    const q = dncRequestNoul('transcript');
    expect(q.type).toBe('noul');
    expect(q.instructions).toContain('`transcript`');
    expect(q.instructions).toContain('NOT a request to stop calling');
    expect(dncRequestNoul('owner_said').instructions).toContain('`owner_said`');
  });

  it('other builders return the expected shapes', () => {
    expect(outcomeChoice({ a: 'A' }).type).toBe('choice');
    expect(appointmentNoul().type).toBe('noul');
    expect(callbackTimeNoul().type).toBe('noul');
    expect(columnFieldChoice({ a: 'A' }).type).toBe('choice');
    expect(dncColumnNoul().type).toBe('noul');
    const v = dncValueChoice();
    if (v.type !== 'choice') throw new Error();
    expect(Object.keys(v.criteria)).toEqual(['do_not_call', 'callable', 'unknown']);
  });

  it('DEFAULT_PLAYBOOK uses the four revised criteria', () => {
    const by = Object.fromEntries(DEFAULT_PLAYBOOK.map((c) => [c.key, c.criteria]));
    expect(by.not_interested).toContain('flat refusal of the caller');
    expect(by.call_me_later).toContain('THIS conversation');
    expect(by.timing_not_ready).toContain('SELLING');
    expect(by.taking_off_market).toContain('staying put');
    expect(DEFAULT_PLAYBOOK.some((c) => c.key === 'none')).toBe(false);
  });
});

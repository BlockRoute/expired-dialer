import { describe, expect, it } from 'vitest';
import { buildOwnerTurn, type Segment } from './transcript';

const seg = (speaker: 'rep' | 'owner', text: string, tStart: number, tEnd: number, final = true): Segment => ({
  speaker, text, tStart, tEnd, final,
});

describe('buildOwnerTurn', () => {
  const fixture: Segment[] = [
    seg('rep', 'Hi, is this Dana?', 0, 2),
    seg('owner', 'Yes it is.', 2.5, 4),
    seg('rep', 'I saw your listing expired.', 5, 8),
    seg('owner', 'Yeah, it did.', 9, 10),
    seg('owner', 'We are not sure what to do.', 10.5, 13),
  ];

  it('joins only owner finals after the last rep final', () => {
    expect(buildOwnerTurn(fixture, 3).ownerSaid).toBe('Yeah, it did. We are not sure what to do.');
  });

  it('ends transcriptSoFar with the last rep line and excludes ownerSaid', () => {
    const turn = buildOwnerTurn(fixture, 3);
    expect(turn.transcriptSoFar).toBe(
      ['Rep: Hi, is this Dana?', 'Owner: Yes it is.', 'Rep: I saw your listing expired.'].join('\n'),
    );
    expect(turn.transcriptSoFar).not.toContain('Yeah, it did.');
    expect(turn.turnId).toBe(3);
  });

  it('drops segments older than the window, measured from the newest tEnd', () => {
    const segs = [
      seg('rep', 'old opener', 0, 2),
      seg('owner', 'old reply', 3, 5),
      seg('rep', 'recent rep line', 100, 104),
      seg('owner', 'recent owner', 105, 110),
    ];
    const turn = buildOwnerTurn(segs, 1);
    expect(turn.transcriptSoFar).toBe('Rep: recent rep line');
    expect(turn.ownerSaid).toBe('recent owner');
  });

  it('ignores interim segments', () => {
    const segs = [...fixture, seg('owner', 'partial wor', 14, 15, false), seg('rep', 'interim rep', 15, 16, false)];
    const turn = buildOwnerTurn(segs, 1);
    expect(turn.ownerSaid).toBe('Yeah, it did. We are not sure what to do.');
    expect(turn.transcriptSoFar.endsWith('Rep: I saw your listing expired.')).toBe(true);
  });

  it('handles an owner who speaks first (no rep line yet)', () => {
    const turn = buildOwnerTurn([seg('owner', 'Hello?', 0, 1)], 0);
    expect(turn.ownerSaid).toBe('Hello?');
    expect(turn.transcriptSoFar).toBe('');
  });

  it('handles no segments', () => {
    expect(buildOwnerTurn([], 0)).toEqual({ ownerSaid: '', transcriptSoFar: '', turnId: 0 });
  });
});

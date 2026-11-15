export type Segment = { speaker: 'rep' | 'owner'; text: string; tStart: number; tEnd: number; final: boolean };
export type OwnerTurn = { ownerSaid: string; transcriptSoFar: string; turnId: number };

/**
 * What the owner just said (final owner segments after the rep's last final
 * segment) plus the labeled conversation up to and including that rep line,
 * limited to the last `windowS` seconds measured back from the newest final
 * segment's end. Interim segments are ignored.
 */
export function buildOwnerTurn(segments: Segment[], turnId: number, windowS = 90): OwnerTurn {
  const finals = segments.filter((s) => s.final && s.text.trim() !== '');
  if (finals.length === 0) return { ownerSaid: '', transcriptSoFar: '', turnId };

  let lastRep = -1;
  finals.forEach((s, i) => {
    if (s.speaker === 'rep') lastRep = i;
  });

  const ownerSaid = finals
    .slice(lastRep + 1)
    .filter((s) => s.speaker === 'owner')
    .map((s) => s.text.trim())
    .join(' ');

  const cutoff = Math.max(...finals.map((s) => s.tEnd)) - windowS;
  const transcriptSoFar = finals
    .slice(0, lastRep + 1)
    .filter((s) => s.tEnd >= cutoff)
    .map((s) => `${s.speaker === 'rep' ? 'Rep' : 'Owner'}: ${s.text.trim()}`)
    .join('\n');

  return { ownerSaid, transcriptSoFar, turnId };
}

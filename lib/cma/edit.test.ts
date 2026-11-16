import { describe, it, expect } from 'vitest';
import { includedComps, recompute, setExcluded } from './edit';
import type { StoredComp } from './edit';

const c = (zpid: string, soldPrice: number, sqft: number, excluded?: boolean) =>
  ({ zpid, soldPrice, sqft, ppsf: soldPrice / sqft, ...(excluded ? { excluded: true } : {}) }) as StoredComp;
const subject = { sqft: 2000 };
const comps = [c('a', 400000, 2000), c('b', 440000, 2000), c('c', 600000, 2000)];

describe('comp editing', () => {
  it('setExcluded flags and clears without mutating', () => {
    const next = setExcluded(comps, 'c', true);
    expect(next[2].excluded).toBe(true);
    expect(comps[2].excluded).toBeUndefined();
    expect(setExcluded(next, 'c', false)[2].excluded).toBeUndefined();
  });

  it('includedComps drops excluded ones', () => {
    expect(includedComps(setExcluded(comps, 'c', true)).map((x) => x.zpid)).toEqual(['a', 'b']);
  });

  it('recompute runs indicatedValue over included comps only', () => {
    const all = recompute(subject, comps);
    const two = recompute(subject, setExcluded(comps, 'c', true));
    expect(all?.medianPpsf).toBe(220);
    expect(two).toEqual({ medianPpsf: 210, point: 420000, low: 410000, high: 430000 });
  });

  it('recompute returns null when nothing is included or sqft is missing', () => {
    expect(recompute(subject, comps.map((x) => ({ ...x, excluded: true })))).toBeNull();
    expect(recompute({ sqft: null }, comps)).toBeNull();
  });
});

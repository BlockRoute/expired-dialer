import { indicatedValue } from './value';
import type { Comp, Subject } from './types';

/** A comp as stored in `cmas.comps`; excluded ones stay in the jsonb so the editor can bring them back. */
export type StoredComp = Comp & { excluded?: boolean };

export function setExcluded(comps: StoredComp[], zpid: string, excluded: boolean): StoredComp[] {
  return comps.map((c) => {
    if (c.zpid !== zpid) return c;
    const rest = { ...c };
    delete rest.excluded;
    return excluded ? { ...rest, excluded: true } : rest;
  });
}

export function includedComps(comps: StoredComp[]): StoredComp[] {
  return comps.filter((c) => !c.excluded);
}

/** Range over the included comps via indicatedValue; null when there is nothing to compute from. */
export function recompute(subject: Pick<Subject, 'sqft'>, comps: StoredComp[]) {
  const inc = includedComps(comps);
  if (!subject.sqft || inc.length === 0) return null;
  return indicatedValue(subject, inc);
}

import type { Comp, Subject } from './types';

const FIVE_K = 5000;

/** Linear-interpolated quantile of an ascending array. */
function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Median $/sqft x subject sqft. The range is the comps' interquartile $/sqft span x subject sqft,
 * rounded outward to $5k. Never uses a vendor AVM.
 */
export function indicatedValue(subject: Pick<Subject, 'sqft'>, comps: Pick<Comp, 'ppsf'>[]) {
  if (!subject.sqft || comps.length === 0) throw new Error('indicatedValue needs subject sqft and at least one comp');
  const ppsf = comps.map((c) => c.ppsf).sort((a, b) => a - b);
  const median = quantile(ppsf, 0.5);
  return {
    medianPpsf: Math.round(median * 100) / 100,
    point: Math.round(median * subject.sqft),
    low: Math.floor((quantile(ppsf, 0.25) * subject.sqft) / FIVE_K) * FIVE_K,
    high: Math.ceil((quantile(ppsf, 0.75) * subject.sqft) / FIVE_K) * FIVE_K,
  };
}

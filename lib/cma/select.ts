import type { Active, Comp, RawComp, Subject, Window } from './types';
import { WINDOWS, zillowActive, zillowSold, type Budget } from './zillow';

const EARTH_MILES = 3958.8;
const DAY = 86_400_000;
const ACRE = 43_560;
const MAX_COMPS = 7;
const ENOUGH = 5;

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(a));
}

/** Days from first Zillow listing date to sold date (UTC dates). Null if the listing date is missing or after the sale. Never `daysOnZillow`. */
export function domDays(soldMs: number, listingMs: number | null): number | null {
  if (listingMs == null) return null;
  const day = (ms: number) => Math.floor(ms / DAY);
  const d = day(soldMs) - day(listingMs);
  return d >= 0 ? d : null;
}

/**
 * Credible comps per the comp-map skill: true distance, no non-arm's-length sales (under 0.6 x tax
 * assessment), no much-older homes when 5 others remain, no acreage lots against a small subject lot.
 * Ordered: within 10% of subject sqft, then most recent, then closest build year and bed/bath match. Max 7.
 */
export function credibleComps(subject: Subject, raw: RawComp[], limit = MAX_COMPS): Comp[] {
  let comps: Comp[] = [];
  for (const r of raw) {
    if (r.soldPrice == null || r.soldPrice <= 0 || r.soldDate == null || !r.sqft || r.sqft <= 0) continue;
    if (subject.taxAssessed && r.soldPrice < 0.6 * subject.taxAssessed) continue;
    if (subject.lotSqft && subject.lotSqft < ACRE && r.lotSqft && r.lotSqft > 3 * subject.lotSqft) continue;
    comps.push({
      zpid: r.zpid,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      soldPrice: r.soldPrice,
      soldDate: new Date(r.soldDate).toISOString().slice(0, 10),
      dom: domDays(r.soldDate, r.listingDate),
      beds: r.beds,
      baths: r.baths,
      sqft: r.sqft,
      yearBuilt: r.yearBuilt,
      lotSqft: r.lotSqft,
      ppsf: r.soldPrice / r.sqft,
      distanceMiles: haversineMiles(subject.lat, subject.lng, r.lat, r.lng),
      zillowUrl: `https://www.zillow.com/homedetails/${r.zpid}_zpid/`,
    });
  }
  if (subject.yearBuilt) {
    const near = comps.filter((c) => c.yearBuilt == null || Math.abs(c.yearBuilt - subject.yearBuilt!) <= 30);
    if (near.length >= ENOUGH) comps = near;
  }
  const samePlan = (c: Comp) => (subject.sqft && Math.abs(c.sqft - subject.sqft) <= 0.1 * subject.sqft ? 0 : 1);
  const yearGap = (c: Comp) => (subject.yearBuilt && c.yearBuilt ? Math.abs(c.yearBuilt - subject.yearBuilt) : 99);
  const bedBath = (c: Comp) => (c.beds === subject.beds ? 0 : 1) + (c.baths === subject.baths ? 0 : 1);
  return comps
    .sort((a, b) =>
      samePlan(a) - samePlan(b) ||
      b.soldDate.localeCompare(a.soldDate) ||
      yearGap(a) - yearGap(b) ||
      bedBath(a) - bedBath(b))
    .slice(0, limit);
}

/**
 * Walks WINDOWS tightest first and stops at the first with 5+ credible comps. Once the window is longer
 * than 90 days, every credible sale from the 90-day window is kept and older sales (best-ranked first)
 * are added only as needed to reach 5. If no window gets there, the last window's set is returned.
 */
export async function searchComps(subject: Subject, budget?: Budget): Promise<{ comps: Comp[]; window: Window; requests: number }> {
  let comps: Comp[] = [];
  let window = WINDOWS[0];
  let requests = 0;
  let recentIds = new Set<string>();
  for (const w of WINDOWS) {
    requests++;
    window = w;
    const ranked = credibleComps(subject, await zillowSold(subject, w, budget), Infinity);
    if (w.soldInLast === '90_days') {
      recentIds = new Set(ranked.map((c) => c.zpid));
      comps = ranked.slice(0, MAX_COMPS);
    } else {
      const recent = ranked.filter((c) => recentIds.has(c.zpid)).slice(0, MAX_COMPS);
      const older = ranked.filter((c) => !recentIds.has(c.zpid));
      comps = [...recent, ...older.slice(0, Math.max(0, ENOUGH - recent.length))];
    }
    if (comps.length >= ENOUGH) break;
  }
  return { comps, window, requests };
}

const MAX_ACTIVES = 10;

/** One extra request at the chosen window's radius. Any failure yields [] so it never fails the CMA. Excludes the subject itself. */
export async function searchActives(subject: Subject, window: Window, budget?: Budget): Promise<Active[]> {
  try {
    return (await zillowActive(subject, window, budget))
      .filter((a) => a.zpid !== subject.zpid)
      .map((a) => ({
        ...a,
        distanceMiles: haversineMiles(subject.lat, subject.lng, a.lat, a.lng),
        zillowUrl: `https://www.zillow.com/homedetails/${a.zpid}_zpid/`,
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)
      .slice(0, MAX_ACTIVES);
  } catch {
    return [];
  }
}

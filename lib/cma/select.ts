import type { Comp, RawComp, Subject, Window } from './types';
import { WINDOWS, zillowSold } from './zillow';

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
export function credibleComps(subject: Subject, raw: RawComp[]): Comp[] {
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
    .slice(0, MAX_COMPS);
}

/** Walks WINDOWS tightest first; stops at the first with 5+ credible comps, else keeps the widest result. */
export async function searchComps(subject: Subject): Promise<{ comps: Comp[]; window: Window; requests: number }> {
  let comps: Comp[] = [];
  let window = WINDOWS[0];
  let requests = 0;
  for (const w of WINDOWS) {
    requests++;
    window = w;
    comps = credibleComps(subject, await zillowSold(subject, w));
    if (comps.length >= ENOUGH) break;
  }
  return { comps, window, requests };
}

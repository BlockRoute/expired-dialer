// Server-only: reads REALTYAPI_KEY. Fail loudly if bundled into a browser.
if (typeof window !== 'undefined') throw new Error('lib/cma/zillow is server-only');

import type { RawActive, RawComp, Subject, Window } from './types';

const BASE = 'https://zillow.realtyapi.io';

/** Sold-search windows, tightest first; the search stops at the first with enough credible comps. */
export const WINDOWS: Window[] = [
  { soldInLast: '90_days', radius: 0.6 },
  { soldInLast: '90_days', radius: 1 },
  { soldInLast: '90_days', radius: 2 },
  { soldInLast: '6_months', radius: 2 },
  { soldInLast: '12_months', radius: 2 },
  { soldInLast: '24_months', radius: 2 },
];

type Json = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 6_000;

/**
 * Shared by every request of one CMA lookup: no request starts or waits past `deadline`
 * (epoch ms), and `requests` counts each one sent (each spends a credit).
 */
export type Budget = { deadline: number; requests: number };

async function get(path: string, params: Record<string, string>, budget?: Budget): Promise<Json | null> {
  const key = process.env.REALTYAPI_KEY;
  if (!key) throw new Error('REALTYAPI_KEY is not set');
  const left = budget ? budget.deadline - Date.now() : REQUEST_TIMEOUT_MS;
  if (left <= 0) throw new Error('RealtyAPI time budget spent');
  if (budget) budget.requests++;
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
    headers: { 'x-realtyapi-key': key },
    signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, left)),
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`RealtyAPI ${path} failed: ${res.status}`);
  return (await res.json()) as Json;
}

/** First finite number among the keys, reading plain numbers and numeric strings. */
function num(o: Json | undefined, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    const n = typeof v === 'string' ? Number(v.replace(/[$,]/g, '')) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

/** Epoch ms from a number, a numeric string, or a date/ISO string; null if none parse. */
function ms(o: Json | undefined, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = /^\d+$/.test(v.trim()) ? Number(v) : Date.parse(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Subject by address. Allowlist only: the response's value-estimate fields are never read. Null when not found. */
export async function zillowByAddress(address: string, budget?: Budget): Promise<Subject | null> {
  const p = await get('/pro/byaddress', { propertyaddress: address }, budget);
  const zpid = num(p ?? undefined, 'zpid');
  const lat = num(p ?? undefined, 'latitude');
  const lng = num(p ?? undefined, 'longitude');
  if (!p || zpid == null || lat == null || lng == null) return null;
  const reso = (p.resoFacts ?? undefined) as Json | undefined;
  return {
    zpid: String(zpid),
    lat,
    lng,
    beds: num(p, 'bedrooms'),
    baths: num(p, 'bathrooms'),
    sqft: num(p, 'livingArea', 'livingAreaValue'),
    yearBuilt: num(p, 'yearBuilt'),
    lotSqft: num(p, 'lotSize', 'lotAreaValue') ?? num(reso, 'lotSize'),
    taxAssessed: num(p, 'taxAssessedValue'),
    homeType: typeof p.homeType === 'string' ? p.homeType : null,
  };
}

function resultList(body: Json | null): Json[] {
  if (!body) return [];
  const direct = body.results ?? body.searchResults;
  return Array.isArray(direct) ? (direct as Json[]) : [];
}

/** Sold houses near the subject within one window, sqft -20%/+25%, newest first. */
export async function zillowSold(subject: Subject, window: Window, budget?: Budget): Promise<RawComp[]> {
  const params: Record<string, string> = {
    latitude: String(subject.lat),
    longitude: String(subject.lng),
    radius: String(window.radius),
    listingStatus: 'Sold',
    homeType: 'Houses',
    sortOrder: 'Newest',
    soldInLast: window.soldInLast,
  };
  if (subject.sqft) params.squareFeetRange = `min:${Math.floor(subject.sqft * 0.8)}, max:${Math.ceil(subject.sqft * 1.25)}`;
  const out: RawComp[] = [];
  for (const r of resultList(await get('/search/bycoordinates', params, budget))) {
    const home = (r.hdpData as Json | undefined)?.homeInfo as Json | undefined;
    const zpid = num(r, 'zpid');
    const lat = num(r, 'latitude') ?? num(r.latLong as Json | undefined, 'latitude') ?? num(home, 'latitude');
    const lng = num(r, 'longitude') ?? num(r.latLong as Json | undefined, 'longitude') ?? num(home, 'longitude');
    if (zpid == null || lat == null || lng == null) continue;
    out.push({
      zpid: String(zpid),
      address: typeof r.address === 'string' ? r.address : String(r.addressStreet ?? ''),
      lat,
      lng,
      soldPrice: num(r, 'lastSoldPrice', 'soldPrice', 'unformattedPrice', 'price'),
      soldDate: ms(r, 'lastSoldDate') ?? ms(home, 'dateSold'),
      listingDate: ms(r, 'listingDateTimeOnZillow'),
      beds: num(r, 'bedrooms', 'beds'),
      baths: num(r, 'bathrooms', 'baths'),
      sqft: num(r, 'livingArea', 'area') ?? num(home, 'livingArea'),
      yearBuilt: num(r, 'yearBuilt') ?? num(home, 'yearBuilt'),
      lotSqft: num(r, 'lotSize', 'lotAreaValue') ?? num(home, 'lotAreaValue'),
    });
  }
  return out;
}

/** For-sale houses near the subject, same radius and sqft band as the sold window. Allowlist only. */
export async function zillowActive(subject: Subject, window: Window, budget?: Budget): Promise<RawActive[]> {
  const params: Record<string, string> = {
    latitude: String(subject.lat),
    longitude: String(subject.lng),
    radius: String(window.radius),
    listingStatus: 'For_Sale',
    homeType: 'Houses',
  };
  if (subject.sqft) params.squareFeetRange = `min:${Math.floor(subject.sqft * 0.8)}, max:${Math.ceil(subject.sqft * 1.25)}`;
  const out: RawActive[] = [];
  for (const r of resultList(await get('/search/bycoordinates', params, budget))) {
    const home = (r.hdpData as Json | undefined)?.homeInfo as Json | undefined;
    const zpid = num(r, 'zpid');
    const lat = num(r, 'latitude') ?? num(r.latLong as Json | undefined, 'latitude') ?? num(home, 'latitude');
    const lng = num(r, 'longitude') ?? num(r.latLong as Json | undefined, 'longitude') ?? num(home, 'longitude');
    const listPrice = num(r, 'unformattedPrice', 'price');
    if (zpid == null || lat == null || lng == null || listPrice == null || listPrice <= 0) continue;
    out.push({
      zpid: String(zpid),
      address: typeof r.address === 'string' ? r.address : String(r.addressStreet ?? ''),
      lat,
      lng,
      listPrice,
      beds: num(r, 'bedrooms', 'beds'),
      baths: num(r, 'bathrooms', 'baths'),
      sqft: num(r, 'livingArea', 'area') ?? num(home, 'livingArea'),
      dom: num(r, 'daysOnZillow'),
    });
  }
  return out;
}

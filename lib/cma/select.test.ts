import { describe, it, expect, vi, afterEach } from 'vitest';
import { credibleComps, haversineMiles, domDays, searchComps } from './select';
import type { RawComp, Subject } from './types';
import { SUBJECT, soldSearch } from './fixtures/zillow';

const subject: Subject = { ...SUBJECT, taxAssessed: 297000 };
const raw = (o: Partial<RawComp>): RawComp => ({
  zpid: '1', address: '1 A St, Richmond, VA 23225', lat: subject.lat, lng: subject.lng + 0.005,
  soldPrice: 400000, soldDate: Date.UTC(2026, 9, 1), listingDate: Date.UTC(2026, 8, 1),
  beds: 3, baths: 2, sqft: 2000, yearBuilt: 1990, lotSqft: 8000, ...o,
});

describe('haversineMiles', () => {
  it('0.01 degrees of latitude is about 0.691 miles', () => {
    expect(haversineMiles(37.54, -77.43, 37.55, -77.43)).toBeCloseTo(0.691, 3);
  });
});

describe('domDays', () => {
  it('is the UTC-date difference between listing and sold timestamps', () => {
    expect(domDays(Date.UTC(2026, 9, 1, 23), Date.UTC(2026, 8, 1, 1))).toBe(30);
  });
  it('is null when the listing date is missing or after the sale', () => {
    expect(domDays(Date.UTC(2026, 9, 1), null)).toBeNull();
    expect(domDays(Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 1))).toBeNull();
  });
});

describe('credibleComps', () => {
  it('drops the $116k sale on a $297k assessment (non-arm\'s-length proxy)', () => {
    const out = credibleComps(subject, [raw({ zpid: 'a' }), raw({ zpid: 'bad', soldPrice: 116000 })]);
    expect(out.map((c) => c.zpid)).toEqual(['a']);
  });
  it('computes ppsf, true distance, DOM and the Zillow link', () => {
    const [c] = credibleComps(subject, [raw({ zpid: '777', soldPrice: 410000, sqft: 2050 })]);
    expect(c.ppsf).toBeCloseTo(200, 5);
    expect(c.distanceMiles).toBeGreaterThan(0.2);
    expect(c.distanceMiles).toBeLessThan(0.3);
    expect(c.dom).toBe(30);
    expect(c.soldDate).toBe('2026-10-01');
    expect(c.zillowUrl).toBe('https://www.zillow.com/homedetails/777_zpid/');
  });
  it('dom is null when the listing date is missing', () => {
    expect(credibleComps(subject, [raw({ listingDate: null })])[0].dom).toBeNull();
  });
  it('drops homes more than 30 years apart only when 5 or more others remain', () => {
    const five = [1, 2, 3, 4, 5].map((i) => raw({ zpid: `n${i}` }));
    const old = raw({ zpid: 'old', yearBuilt: 1930 });
    expect(credibleComps(subject, [...five, old]).map((c) => c.zpid)).not.toContain('old');
    expect(credibleComps(subject, [...five.slice(0, 3), old]).map((c) => c.zpid)).toContain('old');
  });
  it('drops acreage lots (over 3x) when the subject lot is under an acre', () => {
    const out = credibleComps(subject, [raw({ zpid: 'ok' }), raw({ zpid: 'acre', lotSqft: 30000 })]);
    expect(out.map((c) => c.zpid)).toEqual(['ok']);
  });
  it('returns at most 7, same-plan (within 10% sqft) and most recent first', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      raw({ zpid: `c${i}`, soldDate: Date.UTC(2026, 9, 1 + i), sqft: i === 0 ? 2010 : 2300 }));
    const out = credibleComps(subject, many);
    expect(out).toHaveLength(7);
    expect(out[0].zpid).toBe('c0');
    expect(out[1].zpid).toBe('c8');
  });
});

describe('searchComps window search', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('stops at the 1-mile window when 0.6 mi yields 3 and 1 mi yields 5', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const radius = new URL(url).searchParams.get('radius');
      const n = radius === '0.6' ? 3 : 5;
      return new Response(JSON.stringify(soldSearch(n)), { status: 200 });
    }));
    process.env.REALTYAPI_KEY = 'test-key';
    const out = await searchComps(subject);
    expect(out.window).toEqual({ soldInLast: '90_days', radius: 1 });
    expect(out.comps).toHaveLength(5);
    expect(out.requests).toBe(2);
    expect(calls).toHaveLength(2);
    const q = new URL(calls[1]).searchParams;
    expect(q.get('listingStatus')).toBe('Sold');
    expect(q.get('homeType')).toBe('Houses');
    expect(q.get('sortOrder')).toBe('Newest');
    expect(q.get('squareFeetRange')).toBe(`min:${Math.floor(subject.sqft! * 0.8)}, max:${Math.ceil(subject.sqft! * 1.25)}`);
  });
});

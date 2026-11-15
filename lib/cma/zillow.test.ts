import { describe, it, expect, vi, afterEach } from 'vitest';
import { zillowByAddress, zillowSold } from './zillow';
import { SUBJECT, byAddressResponse, soldSearch } from './fixtures/zillow';

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', f);
  process.env.REALTYAPI_KEY = 'test-key';
  return f;
}

describe('zillowByAddress', () => {
  it('keeps only the allowlisted subject fields (no Zestimate or other AVM)', async () => {
    stub(byAddressResponse());
    const s = await zillowByAddress('2812 Amherst Ridge Dr, Richmond, VA 23225');
    expect(s).toEqual(SUBJECT);
    const text = JSON.stringify(s).toLowerCase();
    expect(text).not.toContain('zestimate');
  });
  it('sends the key header, a timeout signal, no-store, and the address param to /pro/byaddress', async () => {
    const f = stub(byAddressResponse());
    await zillowByAddress('2812 Amherst Ridge Dr, Richmond, VA 23225');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://zillow.realtyapi.io/pro/byaddress');
    expect(u.searchParams.get('propertyaddress')).toBe('2812 Amherst Ridge Dr, Richmond, VA 23225');
    expect((init.headers as Record<string, string>)['x-realtyapi-key']).toBe('test-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.cache).toBe('no-store');
  });
  it('returns null when the address has no match (404 or no zpid)', async () => {
    stub({}, 404);
    expect(await zillowByAddress('nowhere')).toBeNull();
    stub({ note: 'empty' });
    expect(await zillowByAddress('nowhere')).toBeNull();
  });
  it('throws on a server error so the route can report reason error', async () => {
    stub({}, 500);
    await expect(zillowByAddress('x')).rejects.toThrow();
  });
});

describe('zillowSold', () => {
  it('drops Zestimate fields from comps and hits /search/bycoordinates with the skill params', async () => {
    const f = stub(soldSearch(3));
    const comps = await zillowSold(SUBJECT, { soldInLast: '6_months', radius: 2 });
    expect(comps).toHaveLength(3);
    expect(JSON.stringify(comps).toLowerCase()).not.toContain('zestimate');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.pathname).toBe('/search/bycoordinates');
    expect(u.searchParams.get('latitude')).toBe(String(SUBJECT.lat));
    expect(u.searchParams.get('longitude')).toBe(String(SUBJECT.lng));
    expect(u.searchParams.get('soldInLast')).toBe('6_months');
    expect(u.searchParams.get('radius')).toBe('2');
    expect((init.headers as Record<string, string>)['x-realtyapi-key']).toBe('test-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads lastSoldDate and listingDateTimeOnZillow as epoch ms, numeric strings, or date strings', async () => {
    const sold = Date.UTC(2026, 9, 28);
    const listed = Date.UTC(2026, 9, 1);
    const body = soldSearch(3);
    body.results[0] = { ...body.results[0], lastSoldDate: sold, listingDateTimeOnZillow: listed };
    (body.results[1] as Record<string, unknown>).lastSoldDate = '2026-10-28';
    (body.results[1] as Record<string, unknown>).listingDateTimeOnZillow = '2026-10-01T00:00:00Z';
    (body.results[2] as Record<string, unknown>).lastSoldDate = String(sold);
    (body.results[2] as Record<string, unknown>).listingDateTimeOnZillow = String(listed);
    stub(body);
    const comps = await zillowSold(SUBJECT, { soldInLast: '90_days', radius: 1 });
    expect(comps.map((c) => c.soldDate)).toEqual([sold, sold, sold]);
    expect(comps.map((c) => c.listingDate)).toEqual([listed, listed, listed]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ requireUserApi: vi.fn(async () => ({ id: 'u1' })) }));

const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const state: { lead: Record<string, unknown> | null; cached: Record<string, unknown> | null; inserted: Record<string, unknown>[] } = {
  lead: null,
  cached: null,
  inserted: [],
};
function table(name: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: name === 'leads' ? state.lead : state.cached, error: null });
  q.insert = (row: Record<string, unknown>) => {
    state.inserted.push(row);
    return { select: () => ({ single: async () => ({ data: { id: 'new', ...row }, error: null }) }) };
  };
  return q;
}
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ from: table }) }));

import { GET } from './route';
import { byAddressResponse, forSaleSearch, soldSearch } from '@/lib/cma/fixtures/zillow';

const lead = {
  id: LEAD_ID, property_address: '2812 Amherst Ridge Dr', property_city: 'Richmond', property_state: 'VA',
  property_zip: '23235', normalized_address: '2812 AMHERST RIDGE DR 23235',
};
const call = () => GET(new Request(`http://x/api/cma?leadId=${LEAD_ID}`));
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.lead = lead;
  state.cached = null;
  state.inserted = [];
  process.env.REALTYAPI_KEY = 'test-key';
  fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('GET /api/cma', () => {
  it('a cached no_match row under 24h old makes zero RealtyAPI requests', async () => {
    state.cached = { id: 'm1', price_range: null, comps: [], created_at: ago(5 * HOUR), credits_used: 1 };
    const body = await (await call()).json();
    expect(body).toMatchObject({ cma: null, reason: 'no_match' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });

  it('a no_match row over 24h old is recomputed', async () => {
    state.cached = { id: 'm1', price_range: null, comps: [], created_at: ago(30 * HOUR), credits_used: 1 };
    await call();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('a successful row under 7 days old is a cache hit with zero requests', async () => {
    state.cached = { id: 'c1', price_range: { low: 1, high: 2 }, comps: [], created_at: ago(100 * HOUR) };
    const body = await (await call()).json();
    expect(body.cma.id).toBe('c1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores a miss (price_range null, comps empty, credits counted) when the address is not found', async () => {
    const body = await (await call()).json();
    expect(body).toMatchObject({ cma: null, reason: 'no_match' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ price_range: null, comps: [], credits_used: 1, normalized_address: lead.normalized_address });
  });

  it('stores nothing on a RealtyAPI error', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }));
    const body = await (await call()).json();
    expect(body).toEqual({ cma: null, reason: 'error' });
    expect(state.inserted).toHaveLength(0);
  });

  it('a lead without a property address answers no_address with no requests and no row', async () => {
    state.lead = { ...lead, property_address: null };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cma: null, reason: 'no_address' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });

  const search = (url: string) => {
    const q = new URL(url).searchParams;
    return q.get('listingStatus') === 'For_Sale' ? forSaleSearch(3) : soldSearch(5);
  };

  it('computes and stores a CMA with credits = every request made, actives included', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      new Response(JSON.stringify(url.includes('/pro/byaddress') ? byAddressResponse() : search(url)), { status: 200 }));
    const body = await (await call()).json();
    expect(body.cma.credits_used).toBe(3); // by-address + one sold window + actives
    expect(state.inserted[0].price_range).toMatchObject({ low: expect.any(Number), high: expect.any(Number) });
    expect(state.inserted[0].actives).toHaveLength(3);
  });

  it('an actives failure does not fail the CMA: stored with actives []', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/pro/byaddress')) return new Response(JSON.stringify(byAddressResponse()), { status: 200 });
      if (new URL(url).searchParams.get('listingStatus') === 'For_Sale') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify(soldSearch(5)), { status: 200 });
    });
    const body = await (await call()).json();
    expect(body.cma).toBeTruthy();
    expect(state.inserted[0].actives).toEqual([]);
    expect(state.inserted[0].price_range).toBeTruthy();
  });
});

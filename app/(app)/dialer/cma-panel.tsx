'use client';

import { useEffect, useState } from 'react';

type CmaComp = {
  zpid: string;
  address: string;
  soldPrice: number;
  soldDate: string;
  dom: number | null;
  sqft: number;
  ppsf: number;
  distanceMiles: number;
  zillowUrl: string;
};

type Cma = {
  id: string;
  price_range: { low: number; high: number; medianPpsf: number } | null;
  comps: CmaComp[];
  time_window: string | null;
  radius_miles: number | null;
  credits_used: number;
};

type CmaResult = { cma: Cma | null; reason?: 'no_match' | 'no_address' | 'error' | 'pending' };

// One in-flight or finished request per lead, so a prefetch and the panel share a single call.
const requests = new Map<string, Promise<CmaResult>>();

const PENDING_POLL_MS = 3_000;
const PENDING_POLLS = 10;

async function fetchCma(leadId: string): Promise<CmaResult> {
  try {
    const res = await fetch(`/api/cma?leadId=${leadId}`, { cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as CmaResult | null;
    return !res.ok || !body ? { cma: null, reason: 'error' } : body;
  } catch {
    return { cma: null, reason: 'error' };
  }
}

/** Another request is already searching this address: wait for its stored result instead of searching again. */
async function fetchCmaWaiting(leadId: string): Promise<CmaResult> {
  for (let i = 0; i < PENDING_POLLS; i++) {
    const r = await fetchCma(leadId);
    if (r.reason !== 'pending') return r;
    await new Promise((done) => setTimeout(done, PENDING_POLL_MS));
  }
  return { cma: null, reason: 'error' };
}

function loadCma(leadId: string): Promise<CmaResult> {
  let p = requests.get(leadId);
  if (!p) {
    p = fetchCmaWaiting(leadId);
    requests.set(leadId, p);
    // A failure is not remembered, so the next view retries.
    void p.then((r) => {
      if (r.reason === 'error') requests.delete(leadId);
    });
  }
  return p;
}

/** Warm the cache for the next queued lead only. */
export function prefetchCma(leadId: string) {
  void loadCma(leadId);
}

const WINDOW_LABEL: Record<string, string> = {
  '90_days': 'last 3 months',
  '6_months': 'last 6 months',
  '12_months': 'last 12 months',
  '24_months': 'last 24 months',
};

const k = (n: number) => `$${Math.round(n / 1000)}k`;

export function CmaPanel(props: { leadId: string; listPrice: number | null; daysOnMarket: number | null }) {
  const { leadId } = props;
  const [state, setState] = useState<{ leadId: string; result: CmaResult } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCma(leadId).then((result) => {
      if (!cancelled) setState({ leadId, result });
    });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const result = state?.leadId === leadId ? state.result : null;
  const cma = result?.cma ?? null;
  const range = cma?.price_range ?? null;

  return (
    <section className="space-y-2 rounded border border-neutral-300 p-4" aria-label="Quick CMA">
      <h2 className="text-sm font-semibold">Quick CMA</h2>
      {!result && <p className="text-sm text-neutral-500">Pulling sold comps...</p>}
      {result && !cma && (
        <p className="text-sm text-neutral-600">
          {result.reason === 'no_match'
            ? '0 comparable sales found'
            : result.reason === 'no_address'
              ? 'No property address on this lead'
              : 'Comps are unavailable right now. Reload to retry.'}
        </p>
      )}
      {cma && range && (
        <>
          <p className="text-base">
            <span className="font-semibold tabular-nums" data-testid="cma-range">
              {k(range.low)} to {k(range.high)}
            </span>
            <span className="text-neutral-600">
              {' '}
              · ${Math.round(range.medianPpsf)}/sqft median · {cma.comps.length} comps
            </span>
          </p>
          {(props.listPrice != null || props.daysOnMarket != null) && (
            <p className="text-sm text-neutral-700">
              Their listing: {props.listPrice != null ? k(props.listPrice) : 'price n/a'}
              {props.daysOnMarket != null ? ` · ${props.daysOnMarket} DOM` : ''}
            </p>
          )}
          <p className="text-xs text-neutral-500">
            Closed sales · {WINDOW_LABEL[cma.time_window ?? ''] ?? cma.time_window} · {cma.radius_miles} mi
          </p>
          <ul className="space-y-1 text-sm" data-testid="cma-comps">
            {cma.comps.map((c) => (
              <li key={c.zpid} className="flex flex-wrap gap-x-3">
                <a href={c.zillowUrl} target="_blank" rel="noreferrer" className="underline">
                  {c.address.split(',')[0]}
                </a>
                <span className="tabular-nums">${Math.round(c.soldPrice / 1000)}k</span>
                <span className="tabular-nums text-neutral-600">
                  {c.soldDate} · ${Math.round(c.ppsf)}/sqft · {c.sqft} sqft · {c.distanceMiles.toFixed(2)} mi ·{' '}
                  {c.dom == null ? 'DOM n/a' : `${c.dom} DOM`}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span>{cma.credits_used} credits used</span>
            <a href={`/cma/${cma.id}`} className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 hover:bg-neutral-100">
              Open seller page draft
            </a>
          </div>
        </>
      )}
    </section>
  );
}

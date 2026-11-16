'use client';

import { useState, useTransition } from 'react';
import { includedComps, recompute, setExcluded, type StoredComp } from '@/lib/cma/edit';
import { dateLabel, money } from '@/lib/cma/seller';
import type { Subject } from '@/lib/cma/types';
import type { CmaRow } from '@/lib/db/types';
import { draftNotes, publishCma, saveCma } from './actions';

const field = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm';
const btn = 'rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50';

export function CmaEditor({ cma }: { cma: CmaRow }) {
  const subject = cma.subject as Pick<Subject, 'sqft'>;
  const [comps, setComps] = useState<StoredComp[]>(cma.comps as StoredComp[]);
  const [low, setLow] = useState(String(cma.price_range?.low ?? ''));
  const [high, setHigh] = useState(String(cma.price_range?.high ?? ''));
  const [favor, setFavor] = useState(cma.favor_note ?? '');
  const [weigh, setWeigh] = useState(cma.weigh_note ?? '');
  const [notes, setNotes] = useState(cma.notes ?? '');
  const [slug, setSlug] = useState(cma.published_slug && cma.published_at ? cma.published_slug : null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const miss = !cma.price_range;
  const value = recompute(subject, comps);
  const input = () => ({
    excluded: comps.filter((c) => c.excluded).map((c) => c.zpid),
    low: Number(low), high: Number(high), favor, weigh, notes,
  });

  // Toggling a comp recomputes the range; a typed range stays until the next toggle.
  const toggle = (zpid: string, excluded: boolean) => {
    const next = setExcluded(comps, zpid, excluded);
    setComps(next);
    const v = recompute(subject, next);
    if (v) { setLow(String(v.low)); setHigh(String(v.high)); }
  };

  const run = (fn: () => Promise<void>) => start(async () => { setMsg(null); await fn(); });

  if (miss) {
    return <p className="rounded border border-neutral-300 p-3 text-sm">0 comparable sales found. <button className={btn} disabled>Publish</button></p>;
  }

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Comps ({includedComps(comps).length} of {comps.length} included)</h2>
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {comps.map((c) => (
            <li key={c.zpid} className="flex items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" aria-label={`Include ${c.address}`} checked={!c.excluded} onChange={(e) => toggle(c.zpid, !e.target.checked)} />
              <span className={`flex-1 ${c.excluded ? 'text-neutral-400 line-through' : ''}`}>{c.address.split(',')[0]}</span>
              <span className="text-neutral-600">{dateLabel(c.soldDate)} · {c.sqft.toLocaleString('en-US')} sq ft · {money(c.ppsf)} per sq ft</span>
              <span className="font-medium">{money(c.soldPrice)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Price range</h2>
        <div className="flex items-center gap-2 text-sm">
          <input className={`${field} max-w-40`} inputMode="numeric" aria-label="Low" value={low} onChange={(e) => setLow(e.target.value)} />
          <span>to</span>
          <input className={`${field} max-w-40`} inputMode="numeric" aria-label="High" value={high} onChange={(e) => setHigh(e.target.value)} />
        </div>
        <p className="text-xs text-neutral-600">
          {value ? `Median ${money(value.medianPpsf)} per sq ft, point ${money(value.point)}.` : 'Include at least one comp.'}
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Seller page notes</h2>
          <button className={btn} disabled={pending || !value} onClick={() => run(async () => {
            const r = await draftNotes(cma.id, input().excluded);
            if (r.ok) { setFavor(r.favor); setWeigh(r.weigh); } else setMsg(r.error);
          })}>Draft notes</button>
        </div>
        <label className="block text-xs">Works in your favor
          <textarea className={field} rows={2} value={favor} onChange={(e) => setFavor(e.target.value)} />
        </label>
        <label className="block text-xs">Buyers will weigh
          <textarea className={field} rows={2} value={weigh} onChange={(e) => setWeigh(e.target.value)} />
        </label>
        <label className="block text-xs">Private notes (never shown on the seller page)
          <textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button className={btn} disabled={pending} onClick={() => run(async () => {
          const r = await saveCma(cma.id, input());
          setMsg(r.ok ? 'Saved.' : r.error);
        })}>Save</button>
        <button className={btn} disabled={pending || !value} onClick={() => run(async () => {
          const r = await publishCma(cma.id, input());
          if (r.ok) { setSlug(r.slug); setMsg('Published.'); } else setMsg(r.error);
        })}>{slug ? 'Republish' : 'Publish'}</button>
        {msg && <span className="text-sm" role="status">{msg}</span>}
      </div>

      {slug && (
        <p className="text-sm">
          Seller page: <a className="underline" href={`/c/${slug}`} target="_blank" rel="noreferrer">/c/{slug}</a>
        </p>
      )}
    </div>
  );
}

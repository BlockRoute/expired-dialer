'use client';

import { useState, useTransition } from 'react';
import type { DncNumberRow } from '@/lib/db/types';
import { addDnc, removeDnc } from './actions';

const input = 'rounded border border-neutral-300 px-2 py-1 text-sm';

export function DncList({ numbers, total }: { numbers: DncNumberRow[]; total: number }) {
  const [raw, setRaw] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      const r = await addDnc(raw, reason);
      setError(r.ok ? null : r.error);
      if (r.ok) {
        setRaw('');
        setReason('');
      }
    });

  const remove = (number: string) =>
    start(async () => {
      const r = await removeDnc(number, typed);
      setError(r.ok ? null : r.error);
      if (r.ok) {
        setConfirming(null);
        setTyped('');
      }
    });

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Internal DNC list ({total})</h2>
      <div className="flex flex-wrap gap-2">
        <input className={input} placeholder="Phone number" value={raw} onChange={(e) => setRaw(e.target.value)} aria-label="DNC phone number" />
        <input className={input} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button onClick={add} disabled={pending || !raw.trim()} className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">
          Add
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-neutral-200 text-sm">
        {numbers.map((n) => (
          <li key={n.number} className="flex flex-wrap items-center gap-3 py-1.5">
            <span className="font-mono">{n.number}</span>
            <span className="text-neutral-500">{n.reason}</span>
            {confirming === n.number ? (
              <span className="ml-auto flex items-center gap-2">
                <input className={input} placeholder={`Type ${n.number} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} />
                <button onClick={() => remove(n.number)} disabled={pending} className="text-red-700 underline">
                  Confirm remove
                </button>
                <button onClick={() => { setConfirming(null); setTyped(''); }} className="underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button onClick={() => { setConfirming(n.number); setTyped(''); setError(null); }} className="ml-auto underline">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {total > numbers.length && <p className="text-xs text-neutral-500">Showing the newest {numbers.length}.</p>}
    </section>
  );
}

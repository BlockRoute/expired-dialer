'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clearDncReview, markLeadDnc, type LeadActionResult } from '../actions';

const btn = 'rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40';

/** DNC review (Confirm / Not a DNC request) and a plain "Mark lead DNC". Nothing is added to dnc_numbers without a click here. */
export function DncActions({ leadId, inReview, isDnc }: { leadId: string; inReview: boolean; isDnc: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: (id: string) => Promise<LeadActionResult>) =>
    start(async () => {
      setError(null);
      const r = await action(leadId).catch((): LeadActionResult => ({ ok: false, error: 'Something went wrong. Try again.' }));
      if (!r.ok) setError(r.error);
      else router.refresh();
    });

  if (isDnc) return null;
  return (
    <div className="space-y-2">
      {inReview ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <span className="font-medium">
            The post-call check read a request not to be called. Dialing is held until you decide.
          </span>
          <button type="button" className={`${btn} bg-red-700 text-white hover:bg-red-800`} disabled={pending} onClick={() => run(markLeadDnc)}>
            Confirm DNC
          </button>
          <button type="button" className={btn} disabled={pending} onClick={() => run(clearDncReview)}>
            Not a DNC request
          </button>
        </div>
      ) : (
        <button type="button" className={btn} disabled={pending} onClick={() => run(markLeadDnc)}>
          Mark lead DNC
        </button>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { outcomeLabel } from '@/lib/outcomes';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CallbackRow, CallRow, LeadRow, PhoneRow } from '@/lib/db/types';
import { DncActions } from './dnc-actions';

export const dynamic = 'force-dynamic';

const RECORDING_TTL_S = 3600;

const stamp = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

function CallSummary({ summary }: { summary: Record<string, unknown> }) {
  const text = (k: string) => (typeof summary[k] === 'string' && summary[k] ? (summary[k] as string) : null);
  const rows: [string, string | null][] = [
    ['Summary', text('summary')],
    ['Note', text('note')],
    ['Next step', text('next_step')],
  ];
  return (
    <dl className="space-y-0.5 rounded bg-neutral-50 px-2 py-1 text-neutral-700">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k}>
          <dt className="inline font-medium">{k}: </dt>
          <dd className="inline">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [leadRes, phonesRes, callsRes, callbacksRes] = await Promise.all([
    supabase.from('leads').select('*').eq('id', id).maybeSingle(),
    supabase.from('phones').select('*').eq('lead_id', id).order('position'),
    supabase.from('calls').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
    supabase.from('callbacks').select('*').eq('lead_id', id).order('due_at', { ascending: false }),
  ]);
  for (const res of [leadRes, phonesRes, callsRes, callbacksRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const lead = leadRes.data as LeadRow | null;
  if (!lead) notFound();
  const phones = (phonesRes.data ?? []) as PhoneRow[];
  const calls = (callsRes.data ?? []) as CallRow[];
  const callbacks = (callbacksRes.data ?? []) as CallbackRow[];

  const recordingUrls = new Map<string, string>();
  await Promise.all(
    calls
      .filter((c) => c.recording_path)
      .map(async (c) => {
        const { data } = await supabase.storage.from('recordings').createSignedUrl(c.recording_path!, RECORDING_TTL_S);
        if (data) recordingUrls.set(c.id, data.signedUrl);
      }),
  );

  const facts: [string, string | number | null][] = [
    ['Owner', lead.owner_full_name],
    ['Status', lead.status],
    ['Rounds', lead.attempt_rounds],
    ['Next eligible', stamp(lead.next_eligible_at) || null],
    ['Listed', lead.list_price != null ? `$${lead.list_price.toLocaleString('en-US')}` : null],
    ['Original price', lead.original_price != null ? `$${lead.original_price.toLocaleString('en-US')}` : null],
    ['Days on market', lead.days_on_market],
    ['Price cuts', lead.price_cuts],
    ['Expired', lead.expired_date],
    ['Listing office', lead.listing_office],
    ['Email', lead.email],
    ['MLS #', lead.mls_number],
    ['Mailing address', lead.mailing_address],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link className="text-sm underline" href="/leads">All leads</Link>
        <h1 className="text-xl font-semibold">
          {lead.property_address ?? 'Unknown address'} {lead.property_city ?? ''} {lead.property_state ?? ''} {lead.property_zip ?? ''}
        </h1>
      </div>

      <DncActions leadId={lead.id} inReview={!!lead.dnc_review_at} isDnc={lead.status === 'dnc'} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {facts.filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
          <div key={k}>
            <dt className="text-neutral-500">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-1">
        <h2 className="font-medium">Phones</h2>
        <ul className="text-sm">
          {phones.map((p) => (
            <li key={p.id} className="flex gap-3">
              <span className="tabular-nums">{p.number}</span>
              <span className="text-neutral-500">{p.line_type ?? ''}</span>
              <span>{p.status}</span>
              <span className="text-neutral-500">vendor DNC: {p.vendor_dnc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-1">
        <h2 className="font-medium">Callbacks</h2>
        {callbacks.length === 0 ? (
          <p className="text-sm text-neutral-500">None.</p>
        ) : (
          <ul className="text-sm">
            {callbacks.map((c) => (
              <li key={c.id}>
                {stamp(c.due_at)} {c.done_at ? `(done ${stamp(c.done_at)})` : ''} {c.note ? `· ${c.note}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Calls</h2>
        {calls.length === 0 ? (
          <p className="text-sm text-neutral-500">No calls yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
            {calls.map((c) => (
              <li key={c.id} className="space-y-1 px-3 py-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span>
                    <span className="font-medium">{c.outcome ? outcomeLabel(c.outcome) : 'No outcome saved'}</span>
                    <span className="text-neutral-500"> · {c.direction} · {c.status}</span>
                    {c.dnc_suspected && c.outcome !== 'dnc' && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-800">DNC request suspected</span>
                    )}
                  </span>
                  <span className="text-neutral-600">{stamp(c.started_at ?? c.created_at)}</span>
                </div>
                {c.note && <p className="text-neutral-700">{c.note}</p>}
                {c.ai_summary && <CallSummary summary={c.ai_summary} />}
                {recordingUrls.has(c.id) && <audio controls preload="none" src={recordingUrls.get(c.id)} className="w-full" />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

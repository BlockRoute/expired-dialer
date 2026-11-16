import Link from 'next/link';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ImportBatchRow, LeadRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

type Row = LeadRow & { import_batches: Pick<ImportBatchRow, 'vendor' | 'file_name'> | null };

const STATUS_LABEL: Record<LeadRow['status'], string> = {
  new: 'New',
  working: 'Working',
  callback: 'Callback',
  appointment: 'Appointment',
  dead: 'Dead',
  dnc: 'DNC',
  out_of_state: 'Out of state',
};

export default async function LeadsPage() {
  const supabase = await createSupabaseServerClient();
  // Ordered pages (id breaks ties) so lists past PostgREST's 1,000-row cap are complete.
  const rows = await fetchAll<Row>((from, to) =>
    supabase
      .from('leads')
      .select('*, import_batches(vendor, file_name)')
      .order('expired_date', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, to),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <Link className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100" href="/import">
          Import
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">No leads yet. Import a list to get started.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-300 text-neutral-600">
            <tr>
              <th className="py-2 pr-3">Address</th>
              <th className="pr-3">Owner</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Batch</th>
              <th className="pr-3">Expired</th>
              <th>Rounds</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-neutral-100">
                <td className="py-2 pr-3">
                  <Link className="underline" href={`/leads/${l.id}`}>{l.property_address ?? 'Unknown address'}</Link>
                </td>
                <td className="pr-3">{l.owner_full_name ?? ''}</td>
                <td className="pr-3">
                  {STATUS_LABEL[l.status]}
                  {l.dnc_review_at && l.status !== 'dnc' && <span className="ml-1 text-red-700">· DNC review</span>}
                </td>
                <td className="pr-3">{l.import_batches?.vendor ?? l.import_batches?.file_name ?? ''}</td>
                <td className="pr-3">{l.expired_date ?? ''}</td>
                <td>{l.attempt_rounds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

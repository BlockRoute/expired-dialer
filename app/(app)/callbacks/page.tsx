import Link from 'next/link';
import { easternParts } from '@/lib/time';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CallbackRow, LeadRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

type Row = CallbackRow & { leads: Pick<LeadRow, 'id' | 'property_address' | 'owner_full_name'> | null };

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export default async function CallbacksPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('callbacks')
    .select('*, leads(id, property_address, owner_full_name)')
    .order('due_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);

  const now = new Date();
  const today = easternParts(now).date;
  const rows = (data ?? []) as Row[];
  const sections: { title: string; rows: Row[] }[] = [
    { title: 'Overdue', rows: rows.filter((r) => !r.done_at && new Date(r.due_at) <= now && easternParts(new Date(r.due_at)).date < today) },
    { title: 'Today', rows: rows.filter((r) => !r.done_at && easternParts(new Date(r.due_at)).date === today) },
    { title: 'Upcoming', rows: rows.filter((r) => !r.done_at && easternParts(new Date(r.due_at)).date > today) },
    { title: 'Done', rows: rows.filter((r) => r.done_at).reverse() },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold">Callbacks</h1>
      {sections.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="font-medium">{s.title} <span className="text-sm text-neutral-500">({s.rows.length})</span></h2>
          {s.rows.length === 0 ? (
            <p className="text-sm text-neutral-500">None.</p>
          ) : (
            <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
              {s.rows.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
                  <span>
                    {r.leads ? (
                      <Link className="font-medium underline" href={`/leads/${r.leads.id}`}>
                        {r.leads.property_address ?? 'Unknown address'}
                      </Link>
                    ) : 'Deleted lead'}
                    <span className="text-neutral-600"> · {r.leads?.owner_full_name ?? 'Unknown owner'}</span>
                    {r.note && <span className="text-neutral-500"> · {r.note}</span>}
                  </span>
                  <span className="whitespace-nowrap text-neutral-600">{when(r.due_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

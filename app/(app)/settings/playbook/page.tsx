import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import type { CoachAction, PlaybookCardRow } from '@/lib/db/types';
import { mostOverridden } from '@/lib/settings';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PlaybookClient } from './playbook-client';

const PAGE = 1000;
const thirtyDaysAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString();

export default async function PlaybookPage() {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const since = thirtyDaysAgo();

  const cardsRes = await supabase.from('playbook_cards').select('*').order('sort');
  if (cardsRes.error) return <p className="text-sm text-red-700">Could not load the playbook.</p>;

  const logged: { card_key: string; action: CoachAction | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('coach_cards')
      .select('card_key, action')
      .gte('created_at', since)
      .order('created_at')
      .range(from, from + PAGE - 1);
    if (error) return <p className="text-sm text-red-700">Could not load the coach log.</p>;
    logged.push(...(data as typeof logged));
    if (!data || data.length < PAGE) break;
  }
  const overridden = mostOverridden(logged);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Playbook</h1>
        <Link href="/settings" className="text-sm underline">
          Settings
        </Link>
      </div>
      <PlaybookClient cards={cardsRes.data as PlaybookCardRow[]} />
      <section className="space-y-2">
        <h2 className="font-medium">Most overridden (last 30 days, at least 5 shows)</h2>
        {overridden.length === 0 ? (
          <p className="text-sm text-neutral-500">Not enough data yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1">Card</th>
                <th>Shows</th>
                <th>Switched</th>
                <th>Dismissed</th>
                <th>Override rate</th>
              </tr>
            </thead>
            <tbody>
              {overridden.map((r) => (
                <tr key={r.key} className="border-t border-neutral-200">
                  <td className="py-1 font-mono">{r.key}</td>
                  <td>{r.shows}</td>
                  <td>{r.switched}</td>
                  <td>{r.dismissed}</td>
                  <td>{Math.round(r.rate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

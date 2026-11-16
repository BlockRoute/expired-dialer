import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import type { DncNumberRow, SettingsRow } from '@/lib/db/types';
import { COMPLIANCE_NOTE } from '@/lib/settings';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DncList } from './dnc-list';
import { SettingsForm } from './settings-form';
import { VoicemailDrops } from './voicemail-drops';

export default async function SettingsPage() {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const [settingsRes, dncRes, dncCount] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('dnc_numbers').select('*').order('added_at', { ascending: false }).limit(200),
    supabase.from('dnc_numbers').select('*', { count: 'exact', head: true }),
  ]);
  const settings = settingsRes.data as SettingsRow | null;
  if (settingsRes.error || !settings) return <p className="text-sm text-red-700">Could not load settings.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Link href="/settings/playbook" className="text-sm underline">
          Playbook cards
        </Link>
      </div>
      <p className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">{COMPLIANCE_NOTE}</p>
      <SettingsForm settings={settings} />
      <VoicemailDrops drops={settings.voicemail_drops} />
      <DncList numbers={(dncRes.data ?? []) as DncNumberRow[]} total={dncCount.count ?? 0} />
    </div>
  );
}

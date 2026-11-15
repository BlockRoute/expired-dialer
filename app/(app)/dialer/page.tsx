import { dialablePhones, type FlowLead } from '@/lib/dialer/flow';
import { orderQueue } from '@/lib/queue';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CallbackRow, ImportBatchRow, LeadRow, PhoneRow, SettingsRow } from '@/lib/db/types';
import { Dialer } from './dialer';

export const dynamic = 'force-dynamic';

export default async function DialerPage() {
  const supabase = await createSupabaseServerClient();
  const [leadsRes, callbacksRes, batchesRes, dncRes, settingsRes] = await Promise.all([
    supabase.from('leads').select('*, phones(*)').not('status', 'in', '(dnc,dead,appointment,out_of_state)'),
    supabase.from('callbacks').select('lead_id, due_at').is('done_at', null),
    supabase.from('import_batches').select('*'),
    supabase.from('dnc_numbers').select('number'),
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  for (const res of [leadsRes, callbacksRes, batchesRes, dncRes, settingsRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const settings = settingsRes.data as SettingsRow | null;
  if (!settings) throw new Error('Settings row is missing');

  const earliestDue = new Map<string, string>();
  for (const cb of (callbacksRes.data ?? []) as Pick<CallbackRow, 'lead_id' | 'due_at'>[]) {
    const current = earliestDue.get(cb.lead_id);
    if (!current || cb.due_at < current) earliestDue.set(cb.lead_id, cb.due_at);
  }

  const phonesByLead = new Map<string, PhoneRow[]>();
  const candidates = ((leadsRes.data ?? []) as (LeadRow & { phones: PhoneRow[] })[]).map(({ phones, ...lead }) => {
    phonesByLead.set(lead.id, phones ?? []);
    return { ...lead, dueCallbackAt: earliestDue.get(lead.id) ?? null };
  });
  const queue: FlowLead[] = orderQueue(candidates, new Date()).map((lead) => ({
    lead,
    phones: dialablePhones(phonesByLead.get(lead.id) ?? []),
  }));

  return (
    <Dialer
      queue={queue}
      settings={settings}
      batches={(batchesRes.data ?? []) as ImportBatchRow[]}
      dncNumbers={((dncRes.data ?? []) as { number: string }[]).map((d) => d.number)}
    />
  );
}

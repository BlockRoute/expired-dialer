import { closeLeadRound } from '@/lib/dialer/close-round';
import { callablePhones, type FlowLead } from '@/lib/dialer/flow';
import { orderQueue } from '@/lib/queue';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CallbackRow, ImportBatchRow, LeadRow, PhoneRow, SettingsRow } from '@/lib/db/types';
import { Dialer } from './dialer';

export const dynamic = 'force-dynamic';

export default async function DialerPage() {
  const supabase = await createSupabaseServerClient();

  // A reload mid-visit counts the round (fail closed): close every open visit before building the queue.
  const [openRes, openSettingsRes] = await Promise.all([
    supabase.from('leads').select('*').not('visit_open_at', 'is', null),
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (openRes.error || openSettingsRes.error) throw new Error((openRes.error ?? openSettingsRes.error)!.message);
  if (openSettingsRes.data) {
    const closeAt = new Date();
    for (const open of (openRes.data ?? []) as LeadRow[]) {
      await closeLeadRound(supabase, open, openSettingsRes.data as SettingsRow, closeAt);
    }
  }

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
  const batches = (batchesRes.data ?? []) as ImportBatchRow[];
  const dncNumbers = ((dncRes.data ?? []) as { number: string }[]).map((d) => d.number);
  const ctx = { batches, dncNumbers, settings, now: new Date() };
  // Leads with no phone the guardrails would allow are not offered at all.
  const queue: FlowLead[] = orderQueue(candidates, ctx.now)
    .map((lead) => ({ lead, phones: callablePhones(lead, phonesByLead.get(lead.id) ?? [], ctx) }))
    .filter((entry) => entry.phones.length > 0);

  return (
    <Dialer
      queue={queue}
      settings={settings}
      batches={batches}
      dncNumbers={dncNumbers}
    />
  );
}

'use server';

import { requireUser } from '@/lib/auth';
import { closeLeadRound } from '@/lib/dialer/close-round';
import { hasNextCallablePhone } from '@/lib/dialer/flow';
import { applyOutcome, type Advance } from '@/lib/outcomes';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CallRow, CoachAction, ImportBatchRow, LeadRow, PhoneRow, SettingsRow } from '@/lib/db/types';

export type SaveOutcomeResult = { ok: true; advance: Advance } | { ok: false; error: string };

/**
 * Saves a call's outcome and its effects on the lead and phone in one
 * transaction (RPC save_outcome, under the owner's RLS).
 */
export async function saveOutcome(
  callId: string,
  outcome: string,
  note: string,
  callbackAt?: string,
): Promise<SaveOutcomeResult> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const [callRes, settingsRes] = await Promise.all([
    supabase.from('calls').select('*').eq('id', callId).maybeSingle(),
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (callRes.error || settingsRes.error) return { ok: false, error: 'Could not load the call.' };
  const call = callRes.data as CallRow | null;
  const settings = settingsRes.data as SettingsRow | null;
  if (!call || !settings) return { ok: false, error: 'Call not found.' };
  if (!call.lead_id || !call.phone_id) return { ok: false, error: 'This call has no lead or phone.' };
  if (!settings.outcomes.includes(outcome)) return { ok: false, error: `Unknown outcome: ${outcome}` };
  // Already saved (e.g. a retry after a lost response): answer the same way, change nothing.
  if (call.outcome_saved_at) {
    if (call.outcome === outcome && call.outcome_advance) return { ok: true, advance: call.outcome_advance };
    return { ok: false, error: 'An outcome was already saved for this call.' };
  }

  const [leadRes, phonesRes] = await Promise.all([
    supabase.from('leads').select('*').eq('id', call.lead_id).maybeSingle(),
    supabase.from('phones').select('*').eq('lead_id', call.lead_id),
  ]);
  if (leadRes.error || phonesRes.error) return { ok: false, error: 'Could not load the lead.' };
  const lead = leadRes.data as LeadRow | null;
  const phones = (phonesRes.data ?? []) as PhoneRow[];
  const phone = phones.find((p) => p.id === call.phone_id);
  if (!lead || !phone) return { ok: false, error: 'Lead or phone not found.' };

  // A phone only counts as "next" if the phone-level guardrails would let it be dialed.
  const batchIds = [...new Set(phones.map((p) => p.batch_id).filter((id): id is string => !!id))];
  const numbers = phones.map((p) => p.number);
  const [batchesRes, dncRes] = await Promise.all([
    batchIds.length
      ? supabase.from('import_batches').select('*').in('id', batchIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('dnc_numbers').select('number').in('number', numbers),
  ]);
  if (batchesRes.error || dncRes.error) return { ok: false, error: 'Could not load the guardrail data.' };
  const now = new Date();
  const hasNextPhone = hasNextCallablePhone(lead, phones, phone.id, {
    batches: (batchesRes.data ?? []) as ImportBatchRow[],
    dncNumbers: ((dncRes.data ?? []) as { number: string }[]).map((d) => d.number),
    settings,
    now,
  });

  let effects;
  try {
    effects = applyOutcome({ outcome, lead, phone, hasNextPhone, settings, now, callbackAt });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid outcome.' };
  }

  const { data, error } = await supabase.rpc('save_outcome', {
    p_call_id: call.id,
    p_outcome: outcome,
    p_note: note.trim() || null,
    p_lead_status: effects.lead.status ?? null,
    p_lead_attempt_rounds: effects.lead.attempt_rounds ?? null,
    p_lead_next_eligible_at: effects.lead.next_eligible_at ?? null,
    p_phone_status: effects.phone?.status ?? null,
    p_dnc_number: effects.addInternalDnc ?? null,
    p_callback_due_at: effects.callback?.due_at ?? null,
    p_close_callbacks: effects.advance === 'next_lead',
    p_advance: effects.advance,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, advance: (data as Advance | null) ?? effects.advance };
}

/**
 * Daniel left a lead (skip / Next) while its visit may be open: close the round.
 * The server only acts if the voice route opened a visit, and only once.
 */
export async function closeRound(leadId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const [leadRes, settingsRes] = await Promise.all([
    supabase.from('leads').select('*').eq('id', leadId).maybeSingle(),
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  const lead = leadRes.data as LeadRow | null;
  const settings = settingsRes.data as SettingsRow | null;
  if (leadRes.error || settingsRes.error || !lead || !settings) return { ok: false, error: 'Could not load the lead.' };
  if (!lead.visit_open_at) return { ok: true };
  try {
    await closeLeadRound(supabase, lead, settings, new Date());
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not close the round.' };
  }
  return { ok: true };
}

/** The `calls.id` the voice route created for a Twilio parent CallSid, once it exists. */
export async function lookupCallId(callSid: string): Promise<string | null> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('calls').select('id').eq('twilio_parent_sid', callSid).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Records what Daniel did with a coaching card (used, dismissed, or switched to the runner-up). */
export async function recordCoachAction(coachCardId: string, action: CoachAction): Promise<boolean> {
  await requireUser();
  if (!['used', 'dismissed', 'switched'].includes(action)) return false;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('coach_cards').update({ action }).eq('id', coachCardId);
  return !error;
}

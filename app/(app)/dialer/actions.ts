'use server';

import { requireUser } from '@/lib/auth';
import { dialablePhones } from '@/lib/dialer/flow';
import { applyOutcome, type Advance } from '@/lib/outcomes';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CallRow, LeadRow, PhoneRow, SettingsRow } from '@/lib/db/types';

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

  const [leadRes, phonesRes] = await Promise.all([
    supabase.from('leads').select('*').eq('id', call.lead_id).maybeSingle(),
    supabase.from('phones').select('*').eq('lead_id', call.lead_id),
  ]);
  if (leadRes.error || phonesRes.error) return { ok: false, error: 'Could not load the lead.' };
  const lead = leadRes.data as LeadRow | null;
  const phones = (phonesRes.data ?? []) as PhoneRow[];
  const phone = phones.find((p) => p.id === call.phone_id);
  if (!lead || !phone) return { ok: false, error: 'Lead or phone not found.' };

  const order = dialablePhones(phones);
  const at = order.findIndex((p) => p.id === phone.id);
  const hasNextPhone = at >= 0 && at + 1 < order.length;

  let effects;
  try {
    effects = applyOutcome({ outcome, lead, phone, hasNextPhone, settings, now: new Date(), callbackAt });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid outcome.' };
  }

  const { error } = await supabase.rpc('save_outcome', {
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
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, advance: effects.advance };
}

/** The `calls.id` the voice route created for a Twilio parent CallSid, once it exists. */
export async function lookupCallId(callSid: string): Promise<string | null> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('calls').select('id').eq('twilio_parent_sid', callSid).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type LeadActionResult = { ok: true } | { ok: false; error: string };

const leadId = z.uuid();

/**
 * Marks a lead DNC without needing a call row (DNC review "Confirm DNC", or the dialer
 * when the call id never arrived). Same effects as a DNC outcome, in one transaction:
 * lead dnc, every number on it into dnc_numbers, the visit closed, callbacks done.
 */
export async function markLeadDnc(id: string): Promise<LeadActionResult> {
  await requireUser();
  if (!leadId.safeParse(id).success) return { ok: false, error: 'Lead not found.' };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('mark_lead_dnc', { p_lead_id: id });
  if (error) return { ok: false, error: 'Could not mark the lead DNC.' };
  if (data !== true) return { ok: false, error: 'Lead not found.' };
  revalidatePath(`/leads/${id}`);
  return { ok: true };
}

/** DNC review "Not a DNC request": the lead is dialable again. Nothing is added to dnc_numbers. */
export async function clearDncReview(id: string): Promise<LeadActionResult> {
  await requireUser();
  if (!leadId.safeParse(id).success) return { ok: false, error: 'Lead not found.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('leads').update({ dnc_review_at: null }).eq('id', id);
  if (error) return { ok: false, error: 'Could not clear the review.' };
  revalidatePath(`/leads/${id}`);
  return { ok: true };
}

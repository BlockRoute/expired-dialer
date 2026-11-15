import type { SupabaseClient } from '@supabase/supabase-js';
import { closeRoundPatch } from '../outcomes';
import type { LeadRow, SettingsRow } from '../db/types';

/**
 * Closes the lead's open visit as one round (server-side, idempotent: the RPC
 * only acts while `visit_open_at` is set). Returns whether a round was counted.
 */
export async function closeLeadRound(
  supabase: SupabaseClient,
  lead: LeadRow,
  settings: SettingsRow,
  now: Date,
): Promise<boolean> {
  const patch = closeRoundPatch(lead, settings, now);
  const { data, error } = await supabase.rpc('close_round', {
    p_lead_id: lead.id,
    p_attempt_rounds: patch.attempt_rounds ?? null,
    p_next_eligible_at: patch.next_eligible_at ?? null,
    p_status: patch.status ?? null,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

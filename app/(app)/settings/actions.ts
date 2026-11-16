'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import type { SettingsRow, VoicemailDrop } from '@/lib/db/types';
import { normalizePhone } from '@/lib/phone';
import { canonicalHours, normalizeOutcomes, validateHours, validateRetry } from '@/lib/settings';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });

const saveSchema = z.object({
  caller_id: z.string().max(40),
  hours: z.unknown(),
  max_rounds: z.number(),
  round_gap_hours: z.number(),
  ring_timeout_s: z.number(),
  outcomes: z.array(z.string()),
});

/** Saves caller ID, hours, retry rules and enabled outcomes. Re-validates everything; the client is not trusted. */
export async function saveSettings(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail('Invalid settings.');
  const v = parsed.data;

  const hours = validateHours(v.hours);
  if (!hours.ok) return fail(hours.error);
  const retry = validateRetry(v);
  if (!retry.ok) return fail(retry.error);
  const outcomes = normalizeOutcomes(v.outcomes);
  if (!outcomes.ok) return fail(outcomes.error);

  let callerId: string | null = null;
  if (v.caller_id.trim() !== '') {
    callerId = normalizePhone(v.caller_id);
    if (!callerId) return fail('Caller ID is not a valid US phone number.');
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('settings')
    .update({
      caller_id: callerId,
      hours: canonicalHours(v.hours),
      max_rounds: v.max_rounds,
      round_gap_hours: v.round_gap_hours,
      ring_timeout_s: v.ring_timeout_s,
      outcomes: outcomes.outcomes,
    })
    .eq('id', 1);
  if (error) return fail('Could not save settings.');
  revalidatePath('/settings');
  return { ok: true };
}

export async function addDnc(raw: string, reason: string): Promise<ActionResult> {
  await requireUser();
  const number = normalizePhone(raw);
  if (!number) return fail('That is not a valid US phone number.');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('dnc_numbers')
    .upsert({ number, reason: reason.trim().slice(0, 200) || 'manual' }, { onConflict: 'number', ignoreDuplicates: true });
  if (error) return fail('Could not add the number.');
  revalidatePath('/settings');
  return { ok: true };
}

/** Removal requires the exact number to be typed; checked here, not just in the UI. */
export async function removeDnc(number: string, typed: string): Promise<ActionResult> {
  await requireUser();
  if (normalizePhone(typed) !== number) return fail('The typed number does not match.');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('dnc_numbers').delete().eq('number', number);
  if (error) return fail('Could not remove the number.');
  revalidatePath('/settings');
  return { ok: true };
}

const MAX_DROPS = 3;
const dropSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(60),
});

/** Registers a drop whose WAV the browser already uploaded to vm-drops as `<id>.wav`. */
export async function addVoicemailDrop(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = dropSchema.safeParse(input);
  if (!parsed.success) return fail('Give the recording a label.');
  const path = `${parsed.data.id}.wav`;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from('settings').select('voicemail_drops').eq('id', 1).maybeSingle();
  if (error || !data) return fail('Could not load settings.');
  const drops = (data as Pick<SettingsRow, 'voicemail_drops'>).voicemail_drops;
  if (drops.length >= MAX_DROPS) {
    await supabase.storage.from('vm-drops').remove([path]);
    return fail(`You can keep up to ${MAX_DROPS} voicemail drops.`);
  }
  if (drops.some((d) => d.id === parsed.data.id)) return fail('That recording is already saved.');
  const next: VoicemailDrop[] = [...drops, { id: parsed.data.id, label: parsed.data.label, path }];
  const { error: upErr } = await supabase.from('settings').update({ voicemail_drops: next }).eq('id', 1);
  if (upErr) return fail('Could not save the voicemail drop.');
  revalidatePath('/settings');
  return { ok: true };
}

/** Removes the settings entry first (so the dialer never offers a missing file), then the storage object. */
export async function deleteVoicemailDrop(id: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('settings').select('voicemail_drops').eq('id', 1).maybeSingle();
  if (error || !data) return fail('Could not load settings.');
  const drops = (data as Pick<SettingsRow, 'voicemail_drops'>).voicemail_drops;
  const drop = drops.find((d) => d.id === id);
  if (!drop) return fail('Voicemail drop not found.');
  const { error: upErr } = await supabase
    .from('settings')
    .update({ voicemail_drops: drops.filter((d) => d.id !== id) })
    .eq('id', 1);
  if (upErr) return fail('Could not delete the voicemail drop.');
  const { error: rmErr } = await supabase.storage.from('vm-drops').remove([drop.path]);
  revalidatePath('/settings');
  if (rmErr) return fail('Removed from settings, but the audio file could not be deleted.');
  return { ok: true };
}

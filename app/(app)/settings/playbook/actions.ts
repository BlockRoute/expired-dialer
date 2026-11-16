'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import type { PlaybookCardRow } from '@/lib/db/types';
import { canDeactivateCard, overlapWarning, topProbabilities, validateCardKey } from '@/lib/settings';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { jev } from '@/lib/typesafe/client';
import { cardChoice } from '@/lib/typesafe/questions';

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

const cardSchema = z.object({
  id: z.uuid().optional(),
  key: z.string().optional(),
  title: z.string().trim().min(1).max(100),
  criteria: z.string().trim().min(1).max(1000),
  say: z.string().trim().max(2000),
  why: z.string().trim().max(1000),
});

/** Creates a card (key validated, unique, then immutable) or edits an existing one by id. */
export async function saveCard(input: unknown): Promise<Result> {
  await requireUser();
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) return fail('Title and criteria are required.');
  const { id, key, title, criteria, say, why } = parsed.data;
  const supabase = await createSupabaseServerClient();

  if (id) {
    // key is deliberately not updatable: coach_cards rows reference it.
    const { error } = await supabase.from('playbook_cards').update({ title, criteria, say, why }).eq('id', id);
    if (error) return fail('Could not save the card.');
  } else {
    if (!key || !validateCardKey(key)) return fail('Key must be a lowercase slug (letters, digits, underscores), not "none".');
    const { data: last } = await supabase.from('playbook_cards').select('sort').order('sort', { ascending: false }).limit(1);
    const sort = ((last?.[0] as { sort: number } | undefined)?.sort ?? 0) + 1;
    const { error } = await supabase.from('playbook_cards').insert({ key, title, criteria, say, why, sort });
    if (error) return fail(error.code === '23505' ? 'A card with that key already exists.' : 'Could not add the card.');
  }
  revalidatePath('/settings/playbook');
  return { ok: true };
}

/** Cards are never hard-deleted: coach_cards reference their key. */
export async function setCardActive(id: string, active: boolean): Promise<Result> {
  await requireUser();
  if (!z.uuid().safeParse(id).success) return fail('Invalid card.');
  const supabase = await createSupabaseServerClient();
  if (!active) {
    const { count, error: cErr } = await supabase
      .from('playbook_cards')
      .select('*', { count: 'exact', head: true })
      .eq('active', true);
    if (cErr) return fail('Could not update the card.');
    if (!canDeactivateCard(count ?? 0)) return fail('Keep at least one active card; the coach needs something to choose from.');
  }
  const { error } = await supabase.from('playbook_cards').update({ active }).eq('id', id);
  if (error) return fail('Could not update the card.');
  revalidatePath('/settings/playbook');
  return { ok: true };
}

const testSchema = z.object({
  line: z.string().trim().min(1).max(500),
  candidateKey: z.string(),
  candidateCriteria: z.string().trim().min(1).max(1000),
  /** Card the test line was written for; defaults to the candidate itself. */
  intendedKey: z.string(),
});

export type TestResult =
  | { ok: true; top: { key: string; p: number }[]; warning: string | null }
  | { ok: false; error: string };

/** Runs one owner line through Jev against the active cards plus the candidate (with its draft criteria). */
export async function testCard(input: unknown): Promise<TestResult> {
  await requireUser();
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter a test line and criteria.' };
  const { line, candidateKey, candidateCriteria, intendedKey } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('playbook_cards').select('key, criteria').eq('active', true).order('sort');
  if (error) return { ok: false, error: 'Could not load the playbook.' };
  const cards = (data as Pick<PlaybookCardRow, 'key' | 'criteria'>[]).filter((c) => c.key !== candidateKey);
  cards.push({ key: candidateKey, criteria: candidateCriteria });

  try {
    const answers = await jev(
      { call_context: 'Real estate agent cold-calling the owner of a recently expired home listing in Virginia.', owner_said: line },
      { card: cardChoice(cards, false) },
      { timeoutMs: 15000 },
    );
    const a = answers.card;
    if (a.type !== 'choice') return { ok: false, error: 'Unexpected answer from Jev.' };
    return { ok: true, top: topProbabilities(a.probabilities), warning: overlapWarning(a.probabilities, intendedKey, candidateKey) };
  } catch (e) {
    console.error('testCard jev failed', e instanceof Error ? e.name : 'unknown');
    return { ok: false, error: 'The test request failed. Try again.' };
  }
}

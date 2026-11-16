'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { aiEnabled, extractText, runClaude } from '@/lib/ai/anthropic';
import { cleanNote, DRAFT_SYSTEM_PROMPT, parseDraft } from '@/lib/cma/copy';
import { includedComps, recompute, type StoredComp } from '@/lib/cma/edit';
import { makeSlug } from '@/lib/cma/slug';
import { streetOf } from '@/lib/cma/seller';
import type { Subject } from '@/lib/cma/types';
import type { CmaRow } from '@/lib/db/types';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type EditResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MODEL = 'claude-sonnet-5-5';
const DRAFT_TIMEOUT_MS = 20_000;
const SLUG_ATTEMPTS = 5;

const editSchema = z.object({
  excluded: z.array(z.string()).max(50),
  low: z.number().int().positive(),
  high: z.number().int().positive(),
  favor: z.string().max(600),
  weigh: z.string().max(600),
  notes: z.string().max(4000),
});
export type EditInput = z.infer<typeof editSchema>;

async function loadOwned(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('cmas').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return { supabase, cma: data as CmaRow | null };
}

const withExcluded = (comps: StoredComp[], excluded: string[]): StoredComp[] =>
  comps.map((c) => {
    const rest = { ...c };
    delete rest.excluded;
    return excluded.includes(c.zpid) ? { ...rest, excluded: true } : rest;
  });

/** Saves the editor state: exclusions, the range (recomputed over included comps, then the typed low/high), and the notes. */
async function persist(id: string, raw: unknown): Promise<EditResult<{ cma: CmaRow; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }>> {
  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Check the range and notes.' };
  const input = parsed.data;
  if (input.low > input.high) return { ok: false, error: 'The low end is above the high end.' };

  const { supabase, cma } = await loadOwned(id);
  if (!cma) return { ok: false, error: 'CMA not found.' };
  if (!cma.price_range) return { ok: false, error: '0 comparable sales found. Nothing to edit.' };

  const comps = withExcluded(cma.comps as StoredComp[], input.excluded);
  const value = recompute(cma.subject as Pick<Subject, 'sqft'>, comps);
  if (!value) return { ok: false, error: 'Include at least one comp.' };

  const patch = {
    comps,
    price_range: { low: input.low, high: input.high, point: value.point, medianPpsf: value.medianPpsf },
    favor_note: cleanNote(input.favor) || null,
    weigh_note: cleanNote(input.weigh) || null,
    notes: input.notes.trim() || null,
  };
  const { data, error } = await supabase.from('cmas').update(patch).eq('id', id).select('*').single();
  if (error) return { ok: false, error: 'Could not save.' };
  return { ok: true, cma: data as CmaRow, supabase };
}

export async function saveCma(id: string, raw: unknown): Promise<EditResult> {
  await requireUser();
  const r = await persist(id, raw);
  return r.ok ? { ok: true } : r;
}

/** Saves, then publishes. An existing slug is kept; a new one retries on a unique collision. */
export async function publishCma(id: string, raw: unknown): Promise<EditResult<{ slug: string }>> {
  await requireUser();
  const r = await persist(id, raw);
  if (!r.ok) return r;
  const { cma, supabase } = r;

  const existing = cma.published_slug;
  for (let attempt = 0; attempt < (existing ? 1 : SLUG_ATTEMPTS); attempt++) {
    const slug = existing ?? makeSlug(streetOf(cma.address));
    const { error } = await supabase
      .from('cmas')
      .update({ published_slug: slug, published_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) return { ok: true, slug };
    if (error.code !== '23505' || existing) return { ok: false, error: 'Could not publish.' };
  }
  return { ok: false, error: 'Could not publish. Try again.' };
}

/** Drafts the two seller notes from the included comps. Output is held to the copy rules before it reaches the editor. */
export async function draftNotes(id: string, excluded: string[]): Promise<EditResult<{ favor: string; weigh: string }>> {
  await requireUser();
  if (!aiEnabled()) return { ok: false, error: 'AI drafting is not set up.' };
  const { cma } = await loadOwned(id);
  if (!cma?.price_range) return { ok: false, error: 'CMA not found.' };

  const subject = cma.subject as Partial<Subject>;
  const comps = includedComps(withExcluded(cma.comps as StoredComp[], excluded)).map((c) => ({
    address: c.address, soldPrice: c.soldPrice, soldDate: c.soldDate, dom: c.dom, beds: c.beds, baths: c.baths,
    sqft: c.sqft, yearBuilt: c.yearBuilt, lotSqft: c.lotSqft, pricePerSqft: Math.round(c.ppsf), distanceMiles: Number(c.distanceMiles.toFixed(2)),
  }));
  const userMessage = JSON.stringify({
    subject: {
      address: streetOf(cma.address), beds: subject.beds, baths: subject.baths, sqft: subject.sqft,
      yearBuilt: subject.yearBuilt, lotSqft: subject.lotSqft,
    },
    closedSales: comps,
  });

  try {
    const message = await runClaude({
      model: MODEL,
      system: DRAFT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 400,
      requestOptions: { timeout: DRAFT_TIMEOUT_MS, maxRetries: 1 },
    });
    const draft = parseDraft(extractText(message));
    if (!draft) return { ok: false, error: 'The draft came back unusable. Try again.' };
    return { ok: true, ...draft };
  } catch {
    return { ok: false, error: 'Drafting is unavailable right now.' };
  }
}

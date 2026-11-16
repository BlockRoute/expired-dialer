import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserApi } from '@/lib/auth';
import { normalizeAddress } from '@/lib/address';
import { withApiErrors } from '@/lib/server/api-errors';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { searchActives, searchComps } from '@/lib/cma/select';
import { indicatedValue } from '@/lib/cma/value';
import { zillowByAddress, type Budget } from '@/lib/cma/zillow';
import type { LeadRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

const CACHE_DAYS = 7;
const MISS_CACHE_MS = 24 * 3_600_000;
// The whole RealtyAPI search must finish well inside a Netlify function (26 s, see README).
const SEARCH_BUDGET_MS = 20_000;
// A pending marker older than this belongs to a function that was killed; it is retired.
const PENDING_STALE_MS = 60_000;
const leadIdSchema = z.uuid();

export const GET = withApiErrors(async (request) => {
  await requireUserApi();
  const parsed = leadIdSchema.safeParse(new URL(request.url).searchParams.get('leadId'));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'leadId is required.' }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('leads').select('*').eq('id', parsed.data).maybeSingle();
  if (error) throw new Error(error.message);
  const lead = data as LeadRow | null;
  if (!lead) return NextResponse.json({ ok: false, error: 'Lead not found.' }, { status: 404 });
  if (!lead.property_address?.trim()) return NextResponse.json({ cma: null, reason: 'no_address' });

  const normalized = lead.normalized_address ?? normalizeAddress(lead.property_address, lead.property_zip);
  const since = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();
  const cached = await supabase
    .from('cmas')
    .select('*')
    .eq('normalized_address', normalized)
    .eq('state', 'done')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cached.error) throw new Error(cached.error.message);
  if (cached.data) {
    // A stored miss (no price range) only counts for 24h; a successful CMA for the full 7 days.
    if (cached.data.price_range) return NextResponse.json({ cma: cached.data, cached: true });
    if (Date.now() - new Date(cached.data.created_at).getTime() < MISS_CACHE_MS) {
      return NextResponse.json({ cma: null, reason: 'no_match', cached: true });
    }
  }

  // Another request (a prefetch, a second tab) is already searching this address.
  const pending = await supabase
    .from('cmas')
    .select('id, created_at')
    .eq('normalized_address', normalized)
    .eq('state', 'pending')
    .maybeSingle();
  if (pending.error) throw new Error(pending.error.message);
  if (pending.data) {
    if (Date.now() - new Date(pending.data.created_at).getTime() < PENDING_STALE_MS) {
      return NextResponse.json({ cma: null, reason: 'pending' });
    }
    const retire = await supabase.from('cmas').update({ state: 'error' }).eq('id', pending.data.id).eq('state', 'pending');
    if (retire.error) throw new Error(retire.error.message);
  }

  const fullAddress = [
    lead.property_address,
    lead.property_city,
    [lead.property_state ?? 'VA', lead.property_zip].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');

  // The in-flight marker goes in before any request; the unique index on pending rows
  // makes a racing request lose here instead of spending the same credits.
  const marker = await supabase
    .from('cmas')
    .insert({
      lead_id: lead.id,
      address: fullAddress,
      normalized_address: normalized,
      subject: {},
      comps: [],
      price_range: null,
      credits_used: 0,
      state: 'pending',
    })
    .select('id')
    .single();
  if (marker.error) {
    if (marker.error.code === '23505') return NextResponse.json({ cma: null, reason: 'pending' });
    throw new Error(marker.error.message);
  }
  const markerId = (marker.data as { id: string }).id;
  const finish = (patch: Record<string, unknown>) =>
    supabase.from('cmas').update({ ...patch, created_at: new Date().toISOString() }).eq('id', markerId);

  const budget: Budget = { deadline: Date.now() + SEARCH_BUDGET_MS, requests: 0 };

  // A miss is stored (no price range, no comps) so a page reload does not spend the credits again.
  const storeMiss = async (subject: object) => {
    const miss = await finish({ subject, comps: [], price_range: null, credits_used: budget.requests, state: 'done' });
    if (miss.error) throw new Error(miss.error.message);
    return NextResponse.json({ cma: null, reason: 'no_match' });
  };

  let computed;
  try {
    const subject = await zillowByAddress(fullAddress, budget);
    if (!subject || !subject.sqft) return await storeMiss(subject ?? {});
    const found = await searchComps(subject, budget);
    if (found.comps.length === 0) return await storeMiss(subject);
    computed = { subject, ...found, value: indicatedValue(subject, found.comps) };
  } catch (e) {
    console.error('CMA lookup failed', e instanceof Error ? e.message : 'unknown');
    // Credits spent are recorded; an error row is never served from the cache.
    const { error: markError } = await finish({ state: 'error', credits_used: budget.requests });
    if (markError) console.error('CMA error row failed', markError.code ?? 'unknown');
    return NextResponse.json({ cma: null, reason: 'error' });
  }

  const { subject, comps, window, value } = computed;
  // One extra request for active competition; a failure (or a spent budget) stores [] and the CMA still goes through.
  const actives = await searchActives(subject, window, budget);
  const done = await supabase
    .from('cmas')
    .update({
      subject,
      comps,
      actives,
      // low/high are what the live coach reads; point and medianPpsf ride along in the same jsonb.
      price_range: { low: value.low, high: value.high, point: value.point, medianPpsf: value.medianPpsf },
      time_window: window.soldInLast,
      radius_miles: window.radius,
      credits_used: budget.requests,
      state: 'done',
      created_at: new Date().toISOString(),
    })
    .eq('id', markerId)
    .select('*')
    .single();
  if (done.error) throw new Error(done.error.message);
  return NextResponse.json({ cma: done.data, cached: false });
});

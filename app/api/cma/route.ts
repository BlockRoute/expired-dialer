import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserApi } from '@/lib/auth';
import { normalizeAddress } from '@/lib/address';
import { withApiErrors } from '@/lib/server/api-errors';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { searchComps } from '@/lib/cma/select';
import { indicatedValue } from '@/lib/cma/value';
import { zillowByAddress } from '@/lib/cma/zillow';
import type { LeadRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

const CACHE_DAYS = 7;
const MISS_CACHE_MS = 24 * 3_600_000;
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

  const fullAddress = [
    lead.property_address,
    lead.property_city,
    [lead.property_state ?? 'VA', lead.property_zip].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');

  // A miss is stored (no price range, no comps) so a page reload does not spend the credits again.
  const storeMiss = async (subject: object, creditsUsed: number) => {
    const miss = await supabase.from('cmas').insert({
      lead_id: lead.id,
      address: fullAddress,
      normalized_address: normalized,
      subject,
      comps: [],
      price_range: null,
      credits_used: creditsUsed,
    });
    if (miss.error) throw new Error(miss.error.message);
    return NextResponse.json({ cma: null, reason: 'no_match' });
  };

  let credits = 1; // the by-address request
  let computed;
  try {
    const subject = await zillowByAddress(fullAddress);
    if (!subject || !subject.sqft) return await storeMiss(subject ?? {}, credits);
    const found = await searchComps(subject);
    credits += found.requests;
    if (found.comps.length === 0) return await storeMiss(subject, credits);
    computed = { subject, ...found, value: indicatedValue(subject, found.comps) };
  } catch (e) {
    console.error('CMA lookup failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ cma: null, reason: 'error' });
  }

  const { subject, comps, window, value } = computed;
  const insert = await supabase
    .from('cmas')
    .insert({
      lead_id: lead.id,
      address: fullAddress,
      normalized_address: normalized,
      subject,
      comps,
      // low/high are what the live coach reads; point and medianPpsf ride along in the same jsonb.
      price_range: { low: value.low, high: value.high, point: value.point, medianPpsf: value.medianPpsf },
      time_window: window.soldInLast,
      radius_miles: window.radius,
      credits_used: credits,
    })
    .select('*')
    .single();
  if (insert.error) throw new Error(insert.error.message);
  return NextResponse.json({ cma: insert.data, cached: false });
});

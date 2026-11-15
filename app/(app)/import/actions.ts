'use server';

import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { jev } from '@/lib/typesafe/client';
import { dncValueChoice } from '@/lib/typesafe/questions';
import { mergeLead, type ImportedLead } from '@/lib/import/build';
import { suggestMapping, type ColumnTarget, type DncValue, type VendorMapping } from '@/lib/import/mapping';
import type { ImportBatchRow, LeadRow } from '@/lib/db/types';

const CHUNK = 500;
const LOOKUP_CHUNK = 100; // `in (...)` filters travel in the URL
const SAMPLE_ROWS = 25;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type SuggestResult =
  | { ok: true; columns: Record<string, ColumnTarget & { confidence: number }>; dncColumnFlags: Record<string, number> }
  | { ok: false; error: string };

/** Saved mapping for a vendor, or null. */
export async function loadMapping(vendor: string): Promise<VendorMapping | null> {
  await requireUser();
  const name = vendor.trim();
  if (!name) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('import_mappings')
    .select('vendor, columns, dnc_values')
    .eq('vendor', name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    vendor: data.vendor,
    columns: data.columns as VendorMapping['columns'],
    dncValues: data.dnc_values as VendorMapping['dncValues'],
  };
}

export async function saveMapping(mapping: VendorMapping): Promise<void> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('import_mappings').upsert(
    {
      vendor: mapping.vendor.trim(),
      columns: mapping.columns,
      dnc_values: mapping.dncValues,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'vendor' },
  );
  if (error) throw new Error(error.message);
}

export async function suggestMappingAction(
  headers: string[],
  rows: Record<string, string>[],
): Promise<SuggestResult> {
  await requireUser();
  try {
    const out = await suggestMapping(headers, rows.slice(0, SAMPLE_ROWS));
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Jev's reading of each distinct DNC cell value, for Daniel to confirm. */
export async function suggestDncValues(
  items: { column: string; value: string }[],
): Promise<Record<string, DncValue>> {
  await requireUser();
  const out: Record<string, DncValue> = {};
  const question = { meaning: dncValueChoice() };
  await Promise.all(
    items.map(async ({ column, value }) => {
      try {
        const a = await jev({ column_header: column, cell_value: value }, question);
        const m = a.meaning;
        const c = m?.type === 'choice' ? m.choice : 'unknown';
        out[value] = c === 'do_not_call' || c === 'callable' ? c : 'unknown';
      } catch {
        out[value] = 'unknown';
      }
    }),
  );
  return out;
}

export async function createBatch(input: {
  fileName: string;
  vendor: string;
  scrubDate: string;
  scrubbedByVendor: boolean;
  totalRows: number;
}): Promise<string> {
  await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scrubDate)) throw new Error('Scrub date is required');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('import_batches')
    .insert({
      file_name: input.fileName,
      vendor: input.vendor.trim() || null,
      scrub_date: input.scrubDate,
      scrubbed_by_vendor: input.scrubbedByVendor,
      total_rows: input.totalRows,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function finishBatch(
  batchId: string,
  totals: { created: number; updated: number; skipped: number; phonesAdded: number },
): Promise<void> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const patch: Partial<ImportBatchRow> = {
    new_leads: totals.created,
    updated_leads: totals.updated,
    skipped_rows: totals.skipped,
    phones_added: totals.phonesAdded,
  };
  const { error } = await supabase.from('import_batches').update(patch).eq('id', batchId);
  if (error) throw new Error(error.message);
}

export async function applyImport(
  batchId: string,
  leads: ImportedLead[],
): Promise<{ created: number; updated: number; phonesAdded: number; dncPhones: number }> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const totals = { created: 0, updated: 0, phonesAdded: 0, dncPhones: 0 };

  for (const batch of chunks(leads, CHUNK)) {
    // 1. Which leads already exist?
    const existing = new Map<string, LeadRow>();
    for (const keys of chunks(batch.map((l) => l.normalizedAddress), LOOKUP_CHUNK)) {
      const { data, error } = await supabase.from('leads').select('*').in('normalized_address', keys);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as LeadRow[]) existing.set(row.normalized_address as string, row);
    }

    const toInsert = batch.filter((l) => !existing.has(l.normalizedAddress));
    const toUpdate = batch.filter((l) => existing.has(l.normalizedAddress));
    const idByAddress = new Map<string, string>();
    for (const [addr, row] of existing) idByAddress.set(addr, row.id);

    // 2. New leads (out-of-state ones start as out_of_state, never dialed).
    if (toInsert.length) {
      const { data, error } = await supabase
        .from('leads')
        .insert(
          toInsert.map((l) => ({
            ...l.fields,
            normalized_address: l.normalizedAddress,
            batch_id: batchId,
            status: l.outOfState ? 'out_of_state' : 'new',
          })),
        )
        .select('id, normalized_address');
      if (error) throw new Error(error.message);
      for (const r of data ?? []) idByAddress.set(r.normalized_address as string, r.id as string);
      totals.created += toInsert.length;
    }

    // 3. Existing leads: listing fields only (mergeLead never touches status).
    if (toUpdate.length) {
      const now = new Date().toISOString();
      const rows = toUpdate.map((l) => {
        const row = existing.get(l.normalizedAddress)!;
        return { ...row, ...mergeLead(row, l), updated_at: now };
      });
      const { error } = await supabase.from('leads').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(error.message);
      totals.updated += toUpdate.length;
    }

    // 4. Phones: existing (lead_id, number) rows are left exactly as they are.
    const phoneRows = batch.flatMap((l) =>
      l.phones.map((p) => ({
        lead_id: idByAddress.get(l.normalizedAddress) as string,
        number: p.number,
        position: p.position,
        line_type: p.lineType,
        vendor_dnc: p.vendorDnc,
      })),
    );
    for (const part of chunks(phoneRows, CHUNK)) {
      const { data, error } = await supabase
        .from('phones')
        .upsert(part, { onConflict: 'lead_id,number', ignoreDuplicates: true })
        .select('vendor_dnc');
      if (error) throw new Error(error.message);
      totals.phonesAdded += data?.length ?? 0;
      totals.dncPhones += (data ?? []).filter((r) => r.vendor_dnc === 'do_not_call').length;
    }
  }
  return totals;
}

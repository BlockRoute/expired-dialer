'use server';

import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { mergeLead, mergeVendorDnc, type ImportedLead } from '@/lib/import/build';
import { importedLeadsSchema, scrubDateError } from '@/lib/import/schema';
import { classifyDncValues, suggestMapping } from '@/lib/import/suggest';
import type { ColumnTarget, DncValue, VendorMapping } from '@/lib/import/mapping';
import type { ImportBatchRow, LeadRow, PhoneRow } from '@/lib/db/types';

const CHUNK = 500;
const LOOKUP_CHUNK = 100; // `in (...)` filters travel in the URL
const UPDATE_CONCURRENCY = 10; // existing leads are patched one row per request

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
  samples: Record<string, string[]>,
  only?: string[],
): Promise<SuggestResult> {
  await requireUser();
  try {
    const out = await suggestMapping(headers, samples, only);
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
  return classifyDncValues(items);
}

export async function createBatch(input: {
  fileName: string;
  vendor: string;
  scrubDate: string;
  scrubbedByVendor: boolean;
  totalRows: number;
}): Promise<string> {
  await requireUser();
  const scrubProblem = scrubDateError(input.scrubDate, new Date());
  if (scrubProblem) throw new Error(scrubProblem);
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
  input: ImportedLead[],
): Promise<{ created: number; updated: number; phonesAdded: number; dncPhones: number }> {
  await requireUser();
  // Untrusted client payload: reject the whole chunk if anything is off.
  const leads = importedLeadsSchema.parse(input) as ImportedLead[];
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

    // 3. Existing leads: listing fields, plus out_of_state when the file now shows a non-VA state
    //    (mergeLead never changes dnc/dead/appointment status).
    //    Only the patch columns are written: a full-row upsert would put back the status,
    //    rounds, cooldown and open visit read above over anything that changed since.
    if (toUpdate.length) {
      const now = new Date().toISOString();
      for (const part of chunks(toUpdate, UPDATE_CONCURRENCY)) {
        await Promise.all(
          part.map(async (l) => {
            const row = existing.get(l.normalizedAddress)!;
            const { status, ...fields } = mergeLead(row, l);
            const { error } = await supabase
              .from('leads')
              .update({ ...fields, batch_id: batchId, updated_at: now })
              .eq('id', row.id);
            if (error) throw new Error(error.message);
            if (status) {
              // out_of_state never overrides a lead closed in the meantime.
              const res = await supabase
                .from('leads')
                .update({ status })
                .eq('id', row.id)
                .not('status', 'in', '(dnc,dead,appointment,out_of_state)');
              if (res.error) throw new Error(res.error.message);
            }
          }),
        );
      }
      totals.updated += toUpdate.length;
    }

    // 4. Phones. A phone's scrub coverage is the last batch that listed it:
    // new phones get this batch; listed-again phones get this batch and a merged
    // vendor_dnc (never downgraded from do_not_call). status is never touched.
    // Phones missing from this file keep their old batch_id.
    const leadIds = [...new Set(batch.map((l) => idByAddress.get(l.normalizedAddress) as string))];
    const existingPhones = new Map<string, PhoneRow>();
    for (const ids of chunks(leadIds, LOOKUP_CHUNK)) {
      const { data, error } = await supabase.from('phones').select('*').in('lead_id', ids);
      if (error) throw new Error(error.message);
      for (const p of (data ?? []) as PhoneRow[]) existingPhones.set(`${p.lead_id}|${p.number}`, p);
    }
    const newPhones: Record<string, unknown>[] = [];
    const updatedPhones: PhoneRow[] = [];
    for (const l of batch) {
      const leadId = idByAddress.get(l.normalizedAddress) as string;
      for (const p of l.phones) {
        const old = existingPhones.get(`${leadId}|${p.number}`);
        if (old) {
          updatedPhones.push({ ...old, vendor_dnc: mergeVendorDnc(old.vendor_dnc, p.vendorDnc), batch_id: batchId });
        } else {
          newPhones.push({
            lead_id: leadId,
            number: p.number,
            position: p.position,
            line_type: p.lineType,
            vendor_dnc: p.vendorDnc,
            batch_id: batchId,
          });
        }
      }
    }
    const uniq = <T,>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];
    const updates = uniq(updatedPhones, (p) => p.id);
    const inserts = uniq(newPhones, (p) => `${p.lead_id}|${p.number}`);
    for (const part of chunks(updates, CHUNK)) {
      const { error } = await supabase.from('phones').upsert(part, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    for (const part of chunks(inserts, CHUNK)) {
      const { data, error } = await supabase.from('phones').insert(part).select('vendor_dnc');
      if (error) throw new Error(error.message);
      totals.phonesAdded += data?.length ?? 0;
      totals.dncPhones += (data ?? []).filter((r) => r.vendor_dnc === 'do_not_call').length;
    }
  }
  return totals;
}

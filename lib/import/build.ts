import { normalizeAddress } from '../address';
import { normalizePhone } from '../phone';
import type { LeadRow, VendorDnc } from '../db/types';
import { effectiveSlot, type ColumnTarget, type FieldKey, type VendorMapping } from './mapping';

export type LineType = 'mobile' | 'landline' | 'voip';

export type ImportedLead = {
  normalizedAddress: string;
  fields: Partial<LeadRow>;
  phones: { number: string; position: number; lineType: LineType | null; vendorDnc: VendorDnc }[];
  outOfState: boolean;
};

export type SkippedRow = { row: number; reason: 'no_address' | 'no_valid_phone' };

const TEXT_FIELDS = [
  'owner_full_name', 'owner_first_name', 'owner_last_name', 'property_address',
  'property_city', 'property_state', 'property_zip', 'mailing_address', 'mailing_state',
  'listing_office', 'email', 'mls_number',
] as const satisfies readonly FieldKey[];
const MONEY_FIELDS = ['list_price', 'original_price'] as const;
const INT_FIELDS = ['days_on_market', 'price_cuts'] as const;

export function parseNumber(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** M/D/YYYY, M/D/YY or YYYY-MM-DD -> YYYY-MM-DD, else null. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    [m, d] = [+match[1], +match[2]];
    y = match[3].length === 2 ? 2000 + +match[3] : +match[3];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function lineType(raw: string): LineType | null {
  switch (raw.trim().toLowerCase()) {
    case 'w': case 'wireless': case 'mobile': case 'cell': return 'mobile';
    case 'l': case 'landline': return 'landline';
    case 'voip': return 'voip';
    default: return null;
  }
}

function dncValue(raw: string, table: VendorMapping['dncValues']): VendorDnc {
  const v = raw.trim();
  if (!v) return 'unknown';
  if (table[v]) return table[v];
  const lower = v.toLowerCase();
  for (const [k, val] of Object.entries(table)) if (k.trim().toLowerCase() === lower) return val;
  return 'unknown';
}

const DNC_RANK: Record<VendorDnc, number> = { do_not_call: 2, callable: 1, unknown: 0 };

function isVirginia(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === 'va' || t === 'virginia';
}

type Slot = { number: string | null; types: string[]; dnc: VendorDnc };

export function buildLeads(
  rows: Record<string, string>[],
  mapping: VendorMapping,
): { leads: ImportedLead[]; skipped: SkippedRow[] } {
  const entries = Object.entries(mapping.columns);
  const byAddress = new Map<string, ImportedLead>();
  const skipped: SkippedRow[] = [];

  rows.forEach((row, idx) => {
    const fields: Record<string, unknown> = {};
    const slots = new Map<number, Slot>();
    const slotOf = (header: string, target: ColumnTarget) => {
      const n = effectiveSlot(header, target);
      if (!slots.has(n)) slots.set(n, { number: null, types: [], dnc: 'unknown' });
      return slots.get(n)!;
    };

    for (const [header, target] of entries) {
      const value = (row[header] ?? '').trim();
      const f = target.field;
      if (f === 'ignore' || f === 'scrub_date') continue;
      if (f === 'phone') {
        const s = slotOf(header, target);
        s.number ??= value ? normalizePhone(value) : null;
      } else if (f === 'phone_type') {
        slotOf(header, target).types.push(value);
      } else if (f === 'phone_dnc') {
        const s = slotOf(header, target);
        const v = dncValue(value, mapping.dncValues);
        if (DNC_RANK[v] > DNC_RANK[s.dnc]) s.dnc = v;
      } else if (!value) {
        continue;
      } else if ((TEXT_FIELDS as readonly string[]).includes(f)) {
        fields[f] ??= value;
      } else if ((MONEY_FIELDS as readonly string[]).includes(f)) {
        fields[f] ??= parseNumber(value);
      } else if ((INT_FIELDS as readonly string[]).includes(f)) {
        const n = parseNumber(value);
        fields[f] ??= n === null ? null : Math.round(n);
      } else if (f === 'expired_date') {
        fields[f] ??= parseDate(value);
      }
    }

    const address = (fields.property_address as string | undefined) ?? '';
    if (!address) return void skipped.push({ row: idx + 1, reason: 'no_address' });

    // Slot 0 holds row-level columns that apply to every phone (worst DNC wins).
    const all = slots.get(0);
    const byNumber = new Map<string, { slot: number; number: string; lineType: LineType | null; vendorDnc: VendorDnc }>();
    for (const [slot, sl] of [...slots.entries()].sort((a, b) => a[0] - b[0])) {
      if (!sl.number) continue;
      const lt = sl.types.map(lineType).find((t) => t !== null) ?? all?.types.map(lineType).find((t) => t !== null) ?? null;
      const dnc = all && DNC_RANK[all.dnc] > DNC_RANK[sl.dnc] ? all.dnc : sl.dnc;
      const dup = byNumber.get(sl.number);
      if (!dup) byNumber.set(sl.number, { slot, number: sl.number, lineType: lt, vendorDnc: dnc });
      else {
        // Same number twice in one row: worst DNC, earliest slot, first known line type.
        if (DNC_RANK[dnc] > DNC_RANK[dup.vendorDnc]) dup.vendorDnc = dnc;
        dup.lineType ??= lt;
      }
    }
    const phones = [...byNumber.values()].sort(
      (a, b) => Number(b.lineType === 'mobile') - Number(a.lineType === 'mobile') || a.slot - b.slot,
    );
    if (phones.length === 0) return void skipped.push({ row: idx + 1, reason: 'no_valid_phone' });

    if (!fields.owner_full_name) {
      const name = [fields.owner_first_name, fields.owner_last_name].filter(Boolean).join(' ');
      if (name) fields.owner_full_name = name;
    }
    fields.raw = Object.fromEntries(Object.entries(row).filter(([k]) => k !== '__proto__'));

    const states = [fields.property_state, fields.mailing_state].filter(Boolean) as string[];
    const outOfState = states.some((s) => !isVirginia(s));
    const normalizedAddress = normalizeAddress(address, (fields.property_zip as string) ?? null);

    const lead: ImportedLead = {
      normalizedAddress,
      fields: fields as Partial<LeadRow>,
      phones: phones.map((p) => ({ number: p.number, position: 0, lineType: p.lineType, vendorDnc: p.vendorDnc })),
      outOfState,
    };

    const existing = byAddress.get(normalizedAddress);
    if (!existing) {
      byAddress.set(normalizedAddress, lead);
    } else {
      // Same address twice in one file: keep first row's fields, union the phones.
      for (const p of lead.phones) {
        const dup = existing.phones.find((e) => e.number === p.number);
        if (!dup) existing.phones.push(p);
        else if (DNC_RANK[p.vendorDnc] > DNC_RANK[dup.vendorDnc]) dup.vendorDnc = p.vendorDnc;
      }
    }
  });

  const leads = [...byAddress.values()];
  for (const l of leads) {
    l.phones.sort((a, b) => Number(b.lineType === 'mobile') - Number(a.lineType === 'mobile'));
    l.phones.forEach((p, i) => (p.position = i + 1));
  }
  return { leads, skipped };
}

/** Most common parseable value in the mapped scrub_date column, as YYYY-MM-DD. */
export function mostCommonScrubDate(rows: Record<string, string>[], mapping: VendorMapping): string | null {
  const headers = Object.entries(mapping.columns)
    .filter(([, t]) => t.field === 'scrub_date')
    .map(([h]) => h);
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const h of headers) {
      const d = parseDate(r[h] ?? '');
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const [d, n] of counts) if (best === null || n > counts.get(best)!) best = d;
  return best;
}

const NEVER_UPDATE = new Set([
  'id', 'status', 'batch_id', 'normalized_address', 'attempt_rounds', 'next_eligible_at',
  'created_at', 'updated_at',
]);

/**
 * Patch applied to an existing lead on re-import: listing fields only.
 * Blank incoming values never overwrite. Status is protected for dnc/dead/appointment;
 * the only change is moving other leads to out_of_state when the new file shows a non-VA state.
 */
export function mergeLead(existing: LeadRow, incoming: ImportedLead): Partial<LeadRow> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming.fields)) {
    if (NEVER_UPDATE.has(k) || v === null || v === undefined || v === '') continue;
    patch[k] = v;
  }
  // A re-import that now shows a non-VA state pulls an active lead out of the queue.
  if (incoming.outOfState && !['dnc', 'dead', 'appointment', 'out_of_state'].includes(existing.status)) {
    patch.status = 'out_of_state';
  }
  return patch as Partial<LeadRow>;
}

/** Re-import merge for a phone's vendor DNC flag: a do_not_call is never downgraded. */
export function mergeVendorDnc(existing: VendorDnc, incoming: VendorDnc): VendorDnc {
  return existing === 'do_not_call' || incoming === 'do_not_call' ? 'do_not_call' : incoming;
}

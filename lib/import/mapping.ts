import type { JevAnswers } from '@/lib/typesafe/client';
import { columnFieldChoice, dncColumnNoul } from '@/lib/typesafe/questions';

export type FieldKey =
  | 'owner_full_name' | 'owner_first_name' | 'owner_last_name'
  | 'property_address' | 'property_city' | 'property_state' | 'property_zip'
  | 'mailing_address' | 'mailing_state'
  | 'list_price' | 'original_price' | 'days_on_market' | 'price_cuts'
  | 'expired_date' | 'listing_office'
  | 'phone' | 'phone_type' | 'phone_dnc' | 'scrub_date'
  | 'email' | 'mls_number' | 'ignore';

/** slot groups phone / phone_type / phone_dnc columns, 1-based. */
export type ColumnTarget = { field: FieldKey; slot?: number };

export type DncValue = 'do_not_call' | 'callable' | 'unknown';

export type VendorMapping = {
  vendor: string;
  columns: Record<string, ColumnTarget>;
  dncValues: Record<string, DncValue>;
};

/** Field descriptions from experiments/typesafe/run.py, plus the three added keys. */
export const FIELDS: Record<FieldKey, string> = {
  owner_full_name: "Owner's full name, or two owners' names together.",
  owner_first_name: "Owner's first name only.",
  owner_last_name: "Owner's last name only.",
  property_address: 'Street address of the listed home.',
  property_city: 'City of the listed home.',
  property_state: 'State of the listed home.',
  property_zip: 'ZIP code of the listed home.',
  mailing_address: "Owner's mailing street address, which may differ from the home.",
  mailing_state: "State of the owner's mailing address.",
  list_price: 'Most recent asking price.',
  original_price: 'First asking price when the listing started.',
  days_on_market: 'Days the listing was on the market.',
  price_cuts: 'Number of times the asking price was reduced.',
  expired_date: 'Date the listing expired or was withdrawn.',
  listing_office: 'The listing brokerage or agent.',
  phone: 'A phone number for the owner.',
  phone_type: 'Whether a phone is mobile/wireless or landline.',
  phone_dnc: 'Whether a phone is on a do-not-call list.',
  scrub_date: 'Date the list was checked against do-not-call registries.',
  email: 'Owner email address.',
  mls_number: 'MLS listing ID.',
  ignore: 'Anything else: status codes, internal IDs, notes, coordinates.',
};

export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[];
const PHONE_FIELDS: FieldKey[] = ['phone', 'phone_type', 'phone_dnc'];

/** First integer in the header: "Phone 1 DNC" -> 1, "Ph2 Status" -> 2. */
export function inferSlot(header: string): number | undefined {
  const m = header.match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}

/** Headers Jev flagged as DNC columns (flag >= 0.5) that are ignored or unmapped. */
export function unmappedDncColumns(mapping: VendorMapping, flags: Record<string, number>): string[] {
  return Object.entries(flags)
    .filter(([header, flag]) => {
      if (flag < 0.5) return false;
      const target = mapping.columns[header];
      return !target || target.field === 'ignore';
    })
    .map(([header]) => header);
}

const MAX_IN_FLIGHT = 6;
const SAMPLE_COUNT = 5;

/** One Jev request per column (field Choice + DNC-column Noul), max 6 in flight. */
export async function suggestMapping(
  headers: string[],
  rows: Record<string, string>[],
): Promise<{
  columns: Record<string, ColumnTarget & { confidence: number }>;
  dncColumnFlags: Record<string, number>;
}> {
  // Dynamic import keeps this module importable from client components.
  const { jev } = await import('@/lib/typesafe/client');
  const questions = { field: columnFieldChoice(FIELDS), dnc: dncColumnNoul() };
  const columns: Record<string, ColumnTarget & { confidence: number }> = {};
  const dncColumnFlags: Record<string, number> = {};

  let next = 0;
  const worker = async () => {
    while (next < headers.length) {
      const header = headers[next++];
      const samples = rows
        .map((r) => r[header] ?? '')
        .filter((v) => v !== '')
        .slice(0, SAMPLE_COUNT);
      const state = {
        file: 'Expired-listing lead export purchased from a lead vendor',
        all_column_headers: headers,
        column: { header, sample_values: samples },
      };
      const answers: JevAnswers = await jev(state, questions);
      const f = answers.field;
      const choice = f?.type === 'choice' && f.choice in FIELDS ? (f.choice as FieldKey) : 'ignore';
      const confidence = f?.type === 'choice' ? f.confidence : 0;
      const target: ColumnTarget & { confidence: number } = { field: choice, confidence };
      if (PHONE_FIELDS.includes(choice)) {
        const slot = inferSlot(header);
        if (slot !== undefined) target.slot = slot;
      }
      columns[header] = target;
      const d = answers.dnc;
      dncColumnFlags[header] = d?.type === 'noul' ? d.noul : 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, headers.length) }, worker));
  return { columns, dncColumnFlags };
}

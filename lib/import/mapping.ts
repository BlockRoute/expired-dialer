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
export const PHONE_FIELDS: FieldKey[] = ['phone', 'phone_type', 'phone_dnc'];

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

/**
 * Slot a column applies to. Phones default to 1; phone_type / phone_dnc with no
 * number in the header default to 0, meaning "all phones in the row" (worst DNC wins).
 */
export function effectiveSlot(header: string, target: ColumnTarget): number {
  const own = target.slot ?? inferSlot(header);
  if (own !== undefined) return own;
  return target.field === 'phone' ? 1 : 0;
}

/** phone_dnc / phone_type columns bound to a slot no phone column uses. */
export function orphanSlotColumns(mapping: VendorMapping): string[] {
  const phoneSlots = new Set(
    Object.entries(mapping.columns)
      .filter(([, t]) => t.field === 'phone')
      .map(([h, t]) => effectiveSlot(h, t)),
  );
  return Object.entries(mapping.columns)
    .filter(([h, t]) => {
      if (t.field !== 'phone_dnc' && t.field !== 'phone_type') return false;
      const slot = effectiveSlot(h, t);
      return slot !== 0 && !phoneSlots.has(slot);
    })
    .map(([h]) => h);
}

const SAMPLE_COUNT = 5;

/**
 * First 5 non-blank values per header, as a plain object (own keys, even for a
 * header named __proto__), safe to pass to a server action.
 */
export function sampleValues(headers: string[], rows: Record<string, string>[]): Record<string, string[]> {
  return Object.fromEntries(
    headers.map((h) => [
      h,
      rows
        .map((r) => r[h] ?? '')
        .filter((v) => v !== '')
        .slice(0, SAMPLE_COUNT),
    ]),
  );
}

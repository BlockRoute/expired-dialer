import { easternParts } from '../time';
import { z } from 'zod';

const text = z.string().max(500).nullable().optional();
const num = z.number().finite().nullable().optional();

/** Listing columns an import may write. Anything else (id, status, timestamps...) is rejected. */
const fieldsSchema = z.strictObject({
  owner_full_name: text,
  owner_first_name: text,
  owner_last_name: text,
  property_address: text,
  property_city: text,
  property_state: text,
  property_zip: text,
  mailing_address: text,
  mailing_state: text,
  list_price: num,
  original_price: num,
  days_on_market: num,
  price_cuts: num,
  expired_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  listing_office: text,
  email: text,
  mls_number: text,
  raw: z.record(z.string(), z.string()).optional(),
});

export const importedLeadSchema = z.strictObject({
  normalizedAddress: z.string().min(1).max(500),
  fields: fieldsSchema,
  phones: z
    .array(
      z.strictObject({
        number: z.string().regex(/^\+1\d{10}$/),
        position: z.number().int().min(1),
        lineType: z.enum(['mobile', 'landline', 'voip']).nullable(),
        vendorDnc: z.enum(['do_not_call', 'callable', 'unknown']),
      }),
    )
    .max(50),
  outOfState: z.boolean(),
});

export const importedLeadsSchema = z.array(importedLeadSchema).max(500);

/** Why a batch scrub date is unusable, or null. A date after today (America/New_York) is a typo that would keep an unscrubbed list callable. */
export function scrubDateError(scrubDate: string, now: Date): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scrubDate);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !d || d.toISOString().slice(0, 10) !== scrubDate) return 'Scrub date is required';
  if (scrubDate > easternParts(now).date) return 'Scrub date cannot be in the future';
  return null;
}

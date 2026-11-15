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

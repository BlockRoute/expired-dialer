-- Quick-CMA cache key: a CMA computed for the same normalized address within 7 days is reused.
-- Filled by the app with normalizeAddress (lib/address.ts), same key as leads.normalized_address.
alter table public.cmas add column normalized_address text;

create index cmas_normalized_address_created_idx
  on public.cmas (normalized_address, created_at desc);

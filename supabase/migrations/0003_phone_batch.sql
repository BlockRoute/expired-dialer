-- A phone's scrub coverage is the last import batch that listed it.
alter table public.phones
  add column batch_id uuid references public.import_batches(id) on delete set null;
create index phones_batch_idx on public.phones (batch_id);

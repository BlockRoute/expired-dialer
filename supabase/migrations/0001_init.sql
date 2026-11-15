-- Expired Dialer: single-user schema.
-- Access model: every public table is locked to the one owner email stored in
-- private.app_owner (insert it once after migrating; see README).

create schema if not exists private;

create table private.app_owner (
  email text primary key
);
revoke all on private.app_owner from public, anon, authenticated;

create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.app_owner
    where lower(email) = lower(auth.email())
  );
$$;

revoke all on function private.is_owner() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_owner() to anon, authenticated;

-- ---------------------------------------------------------------- imports
create table public.import_mappings (
  id uuid primary key default gen_random_uuid(),
  vendor text not null unique,
  columns jsonb not null default '{}'::jsonb,   -- header -> {field, slot}
  dnc_values jsonb not null default '{}'::jsonb, -- confirmed vendor DNC value table
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  vendor text,
  scrub_date date not null,
  scrubbed_by_vendor boolean not null default false,
  total_rows int not null default 0,
  new_leads int not null default 0,
  updated_leads int not null default 0,
  skipped_rows int not null default 0,
  phones_added int not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.import_batches(id) on delete set null,
  status text not null default 'new'
    check (status in ('new','working','callback','appointment','dead','dnc','out_of_state')),
  attempt_rounds int not null default 0,
  next_eligible_at timestamptz,
  normalized_address text unique,
  state text,          -- normalized property state, used for the out_of_state gate
  mailing_state text,
  owner_full_name text,
  owner_first_name text,
  owner_last_name text,
  property_address text,
  property_city text,
  property_state text,
  property_zip text,
  mailing_address text,
  list_price numeric,
  original_price numeric,
  days_on_market int,
  price_cuts int,
  expired_date date,
  listing_office text,
  email text,
  mls_number text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_status_idx on public.leads (status);
create index leads_batch_idx on public.leads (batch_id);
create index leads_next_eligible_idx on public.leads (next_eligible_at);

create table public.phones (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  number text not null,  -- E.164
  position int not null default 1,
  line_type text,
  vendor_dnc text not null default 'unknown'
    check (vendor_dnc in ('do_not_call','callable','unknown')),
  status text not null default 'ok' check (status in ('ok','dead','wrong')),
  created_at timestamptz not null default now(),
  unique (lead_id, number)
);
create index phones_number_idx on public.phones (number);

create table public.dnc_numbers (
  number text primary key,  -- E.164
  reason text,
  added_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ calls
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  phone_id uuid references public.phones(id) on delete set null,
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  status text not null default 'queued'
    check (status in ('queued','ringing','in-progress','completed','busy','no-answer','failed','canceled')),
  twilio_parent_sid text unique,
  twilio_child_sid text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  outcome text,
  outcome_saved_at timestamptz,
  note text,
  recording_path text,
  ai_summary jsonb,
  created_at timestamptz not null default now()
);
create index calls_lead_idx on public.calls (lead_id);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  speaker text not null check (speaker in ('rep','owner')),
  text text not null,
  t_start numeric,
  t_end numeric,
  created_at timestamptz not null default now()
);
create index transcript_segments_call_idx on public.transcript_segments (call_id);

create table public.playbook_cards (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  criteria text,
  say text,
  why text,
  active boolean not null default true,
  sort int not null default 0
);

create table public.coach_cards (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  segment_id uuid references public.transcript_segments(id) on delete set null,
  source text not null check (source in ('jev','claude')),
  card_key text not null,
  confidence numeric,
  runner_up_key text,
  runner_up_probability numeric,
  dnc_p numeric,
  latency_ms int,
  action text check (action in ('used','dismissed','switched')),
  created_at timestamptz not null default now()
);
create index coach_cards_call_idx on public.coach_cards (call_id);

create table public.callbacks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  due_at timestamptz not null,
  done_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index callbacks_due_idx on public.callbacks (due_at) where done_at is null;

create table public.cmas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  address text not null,
  subject jsonb not null default '{}'::jsonb,
  comps jsonb not null default '[]'::jsonb,
  price_range jsonb,
  time_window text,
  radius_miles numeric,
  notes text,
  published_slug text unique,
  published_at timestamptz,
  credits_used int not null default 0,
  created_at timestamptz not null default now()
);

create table public.settings (
  id int primary key default 1 check (id = 1),
  caller_id text,
  hours jsonb not null default '{
    "mon": ["09:00","20:00"], "tue": ["09:00","20:00"], "wed": ["09:00","20:00"],
    "thu": ["09:00","20:00"], "fri": ["09:00","20:00"], "sat": ["09:00","20:00"],
    "sun": null
  }'::jsonb,
  max_rounds int not null default 3,
  round_gap_hours int not null default 24,
  ring_timeout_s int not null default 25,
  outcomes jsonb not null default '[
    "connected","no_answer","left_vm","bad_number","wrong_person","dnc",
    "appointment_set","callback_requested","not_interested",
    "relisted_elsewhere","off_market_or_sold"
  ]'::jsonb,
  voicemail_drops jsonb not null default '[]'::jsonb
);
insert into public.settings (id) values (1);

-- -------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'import_mappings','import_batches','leads','phones','dnc_numbers','calls',
    'transcript_segments','playbook_cards','coach_cards','callbacks','cmas','settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_all on public.%I for all using (private.is_owner()) with check (private.is_owner())',
      t
    );
  end loop;
end $$;

-- Published CMAs are readable by anyone holding the slug link.
create policy cmas_public_read on public.cmas
  for select to anon, authenticated
  using (published_slug is not null);

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public)
values ('vm-drops', 'vm-drops', false), ('recordings', 'recordings', false)
on conflict (id) do nothing;

create policy owner_storage_all on storage.objects
  for all
  using (bucket_id in ('vm-drops','recordings') and private.is_owner())
  with check (bucket_id in ('vm-drops','recordings') and private.is_owner());

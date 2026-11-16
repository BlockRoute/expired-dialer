-- 1. Post-call DNC review. The finish route re-checks the whole transcript with the
--    DNC Noul; when it reads a DNC request (>= 0.5) that the saved outcome is not,
--    the call is flagged and the lead is held out of dialing until Daniel decides.
--    Nothing reaches dnc_numbers without his click (mark_lead_dnc below).
alter table public.calls add column dnc_suspected boolean not null default false;
alter table public.leads add column dnc_review_at timestamptz;

-- 2. A DNC outcome blocks every number on the lead, not only the one dialed.
--    The parameter changes type (text -> text[]), so the old signature is dropped.
drop function public.save_outcome(uuid, text, text, text, int, timestamptz, text, text, timestamptz, boolean, text);

create function public.save_outcome(
  p_call_id uuid,
  p_outcome text,
  p_note text,
  p_lead_status text,
  p_lead_attempt_rounds int,
  p_lead_next_eligible_at timestamptz,
  p_phone_status text,
  p_dnc_numbers text[],
  p_callback_due_at timestamptz,
  p_close_callbacks boolean,
  p_advance text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
  v_lead_closed boolean;
begin
  select * into v_call from public.calls where id = p_call_id for update;
  if not found then
    raise exception 'call not found';
  end if;
  if v_call.lead_id is null or v_call.phone_id is null then
    raise exception 'call has no lead or phone';
  end if;
  -- Exactly one effects-applying save per call. A retry of the same outcome (for
  -- example after a lost response) gets the stored answer and changes nothing.
  -- (The voicemail-drop route sets calls.outcome but not outcome_saved_at.)
  if v_call.outcome_saved_at is not null then
    if v_call.outcome = p_outcome and v_call.outcome_advance is not null then
      return v_call.outcome_advance;
    end if;
    raise exception 'outcome already saved';
  end if;

  update public.calls
     set outcome = p_outcome, outcome_saved_at = now(), note = p_note, outcome_advance = p_advance
   where id = p_call_id;

  -- Closed leads are never re-opened or re-counted; only DNC may escalate them.
  select status in ('dnc','dead','appointment','out_of_state') into v_lead_closed
    from public.leads where id = v_call.lead_id;
  if v_lead_closed is null then
    raise exception 'lead not found';
  end if;

  update public.leads
     set status = coalesce(p_lead_status, status),
         attempt_rounds = coalesce(p_lead_attempt_rounds, attempt_rounds),
         next_eligible_at = coalesce(p_lead_next_eligible_at, next_eligible_at),
         visit_open_at = case when p_advance = 'next_lead' then null else visit_open_at end,
         -- A DNC outcome settles any pending DNC review.
         dnc_review_at = case when p_lead_status = 'dnc' then null else dnc_review_at end,
         updated_at = now()
   where id = v_call.lead_id
     and (not v_lead_closed or p_lead_status = 'dnc');

  if p_advance = 'next_lead' then
    update public.leads set visit_open_at = null where id = v_call.lead_id;
  end if;

  if p_phone_status is not null then
    update public.phones set status = p_phone_status where id = v_call.phone_id;
  end if;

  if p_dnc_numbers is not null then
    insert into public.dnc_numbers (number, reason)
    select distinct n, 'dnc outcome' from unnest(p_dnc_numbers) as n where n is not null
    on conflict (number) do nothing;
  end if;

  if p_close_callbacks then
    update public.callbacks set done_at = now()
     where lead_id = v_call.lead_id and done_at is null;
  end if;

  if p_callback_due_at is not null and not v_lead_closed then
    insert into public.callbacks (lead_id, due_at, note)
    values (v_call.lead_id, p_callback_due_at, p_note);
  end if;

  return p_advance;
end;
$$;

revoke all on function public.save_outcome(uuid, text, text, text, int, timestamptz, text, text[], timestamptz, boolean, text) from public, anon;
grant execute on function public.save_outcome(uuid, text, text, text, int, timestamptz, text, text[], timestamptz, boolean, text) to authenticated;

-- 3. Daniel marks a lead DNC without a call row (DNC review "Confirm DNC", or the
--    dialer when the call id never arrived): the same effects as a DNC outcome.
--    Lead dnc, every number on it into dnc_numbers, the visit closed, callbacks done.
--    Returns false when the lead does not exist (or RLS hides it).
create function public.mark_lead_dnc(p_lead_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.leads where id = p_lead_id for update;
  if not found then
    return false;
  end if;

  update public.leads
     set status = 'dnc', dnc_review_at = null, visit_open_at = null, updated_at = now()
   where id = p_lead_id;

  insert into public.dnc_numbers (number, reason)
  select distinct number, 'marked dnc' from public.phones where lead_id = p_lead_id
  on conflict (number) do nothing;

  update public.callbacks set done_at = now() where lead_id = p_lead_id and done_at is null;
  return true;
end;
$$;

revoke all on function public.mark_lead_dnc(uuid) from public, anon;
grant execute on function public.mark_lead_dnc(uuid) to authenticated;

-- 4. Quick-CMA lookups. A 'pending' row is written before any RealtyAPI request so a
--    concurrent request for the same address waits instead of spending credits again;
--    'error' rows record credits spent on a failed lookup and are never served as a cache hit.
alter table public.cmas
  add column state text not null default 'done' check (state in ('pending','done','error'));

create unique index cmas_one_pending_per_address
  on public.cmas (normalized_address) where state = 'pending';

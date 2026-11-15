-- Saves a call outcome and all of its effects in one transaction, exactly once per call.
-- security invoker: runs as the caller, so the owner-only RLS policies still apply.
-- The lead and phone are taken from the call row, so they cannot disagree with it.
-- Lead/phone parameters are null when that field should stay unchanged.

-- Where the dialer goes next after this call's outcome, kept so a retried save can answer the same way.
alter table public.calls
  add column outcome_advance text check (outcome_advance in ('next_phone','next_lead'));

-- Set by the voice route when a call is placed to the lead; cleared when the round closes.
-- It lets the server count a round even if Daniel skips the lead or reloads mid-visit.
alter table public.leads add column visit_open_at timestamptz;

create function public.save_outcome(
  p_call_id uuid,
  p_outcome text,
  p_note text,
  p_lead_status text,
  p_lead_attempt_rounds int,
  p_lead_next_eligible_at timestamptz,
  p_phone_status text,
  p_dnc_number text,
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
         updated_at = now()
   where id = v_call.lead_id
     and (not v_lead_closed or p_lead_status = 'dnc');

  if p_advance = 'next_lead' then
    update public.leads set visit_open_at = null where id = v_call.lead_id;
  end if;

  if p_phone_status is not null then
    update public.phones set status = p_phone_status where id = v_call.phone_id;
  end if;

  if p_dnc_number is not null then
    insert into public.dnc_numbers (number, reason)
    values (p_dnc_number, 'dnc outcome')
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

revoke all on function public.save_outcome(uuid, text, text, text, int, timestamptz, text, text, timestamptz, boolean, text) from public, anon;
grant execute on function public.save_outcome(uuid, text, text, text, int, timestamptz, text, text, timestamptz, boolean, text) to authenticated;

-- Closes a lead's open visit as one round: idempotent, so a retry cannot double-count.
-- Returns true only when it acted. Closed leads keep their status and counters.
create function public.close_round(
  p_lead_id uuid,
  p_attempt_rounds int,
  p_next_eligible_at timestamptz,
  p_status text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_open timestamptz;
begin
  select status, visit_open_at into v_status, v_open
    from public.leads where id = p_lead_id for update;
  if not found or v_open is null then
    return false;
  end if;

  if v_status in ('dnc','dead','appointment','out_of_state') then
    update public.leads set visit_open_at = null, updated_at = now() where id = p_lead_id;
  else
    update public.leads
       set visit_open_at = null,
           status = coalesce(p_status, status),
           attempt_rounds = coalesce(p_attempt_rounds, attempt_rounds),
           next_eligible_at = coalesce(p_next_eligible_at, next_eligible_at),
           updated_at = now()
     where id = p_lead_id;
  end if;

  update public.callbacks set done_at = now() where lead_id = p_lead_id and done_at is null;
  return true;
end;
$$;

revoke all on function public.close_round(uuid, int, timestamptz, text) from public, anon;
grant execute on function public.close_round(uuid, int, timestamptz, text) to authenticated;

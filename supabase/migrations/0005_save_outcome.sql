-- Saves a call outcome and all of its effects in one transaction.
-- security invoker: runs as the caller, so the owner-only RLS policies still apply.
-- The lead and phone are taken from the call row, so they cannot disagree with it.
-- Lead/phone parameters are null when that field should stay unchanged.
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
  p_close_callbacks boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
begin
  select * into v_call from public.calls where id = p_call_id for update;
  if not found then
    raise exception 'call not found';
  end if;
  if v_call.lead_id is null or v_call.phone_id is null then
    raise exception 'call has no lead or phone';
  end if;
  -- The voicemail-drop route pre-saves left_vm; anything else is saved only once.
  if v_call.outcome_saved_at is not null and v_call.outcome is distinct from 'left_vm' then
    raise exception 'outcome already saved';
  end if;

  update public.calls
     set outcome = p_outcome, outcome_saved_at = now(), note = p_note
   where id = p_call_id;

  update public.leads
     set status = coalesce(p_lead_status, status),
         attempt_rounds = coalesce(p_lead_attempt_rounds, attempt_rounds),
         next_eligible_at = coalesce(p_lead_next_eligible_at, next_eligible_at),
         updated_at = now()
   where id = v_call.lead_id;

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

  if p_callback_due_at is not null then
    insert into public.callbacks (lead_id, due_at, note)
    values (v_call.lead_id, p_callback_due_at, p_note);
  end if;
end;
$$;

revoke all on function public.save_outcome(uuid, text, text, text, int, timestamptz, text, text, timestamptz, boolean) from public, anon;
grant execute on function public.save_outcome(uuid, text, text, text, int, timestamptz, text, text, timestamptz, boolean) to authenticated;

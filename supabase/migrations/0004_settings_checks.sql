-- Dial guardrails depend on these being sane; reject nonsense at the database.
alter table public.settings
  add constraint settings_ring_timeout_s_check check (ring_timeout_s between 0 and 120),
  add constraint settings_max_rounds_check check (max_rounds between 1 and 10),
  add constraint settings_round_gap_hours_check check (round_gap_hours between 1 and 168);

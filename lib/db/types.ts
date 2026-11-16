// Row types mirroring supabase/migrations/0001_init.sql.

export type LeadStatus =
  | 'new' | 'working' | 'callback' | 'appointment' | 'dead' | 'dnc' | 'out_of_state';
export type PhoneStatus = 'ok' | 'dead' | 'wrong';
export type VendorDnc = 'do_not_call' | 'callable' | 'unknown';
export type CallStatus =
  | 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'no-answer' | 'failed' | 'canceled';
export type CallDirection = 'outbound' | 'inbound';
export type CoachAction = 'used' | 'dismissed' | 'switched';

/** Mon-Sat windows as [open, close] "HH:MM"; null means closed. */
export type DayHours = [string, string] | null;
export type Hours = Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DayHours>;

export type ImportMappingRow = {
  id: string;
  vendor: string;
  columns: Record<string, unknown>;
  dnc_values: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ImportBatchRow = {
  id: string;
  file_name: string | null;
  vendor: string | null;
  scrub_date: string;
  scrubbed_by_vendor: boolean;
  total_rows: number;
  new_leads: number;
  updated_leads: number;
  skipped_rows: number;
  phones_added: number;
  created_at: string;
};

export type LeadRow = {
  id: string;
  batch_id: string | null;
  status: LeadStatus;
  attempt_rounds: number;
  next_eligible_at: string | null;
  visit_open_at: string | null;
  normalized_address: string | null;
  mailing_state: string | null;
  owner_full_name: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  mailing_address: string | null;
  list_price: number | null;
  original_price: number | null;
  days_on_market: number | null;
  price_cuts: number | null;
  expired_date: string | null;
  listing_office: string | null;
  email: string | null;
  mls_number: string | null;
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PhoneRow = {
  id: string;
  lead_id: string;
  number: string;
  position: number;
  line_type: string | null;
  vendor_dnc: VendorDnc;
  status: PhoneStatus;
  batch_id: string | null;
  created_at: string;
};

export type DncNumberRow = {
  number: string;
  reason: string | null;
  added_at: string;
};

export type CallRow = {
  id: string;
  lead_id: string | null;
  phone_id: string | null;
  direction: CallDirection;
  status: CallStatus;
  twilio_parent_sid: string | null;
  twilio_child_sid: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  outcome: string | null;
  outcome_saved_at: string | null;
  outcome_advance: 'next_phone' | 'next_lead' | null;
  note: string | null;
  recording_path: string | null;
  ai_summary: Record<string, unknown> | null;
  created_at: string;
};

export type TranscriptSegmentRow = {
  id: string;
  call_id: string;
  speaker: 'rep' | 'owner';
  text: string;
  t_start: number | null;
  t_end: number | null;
  created_at: string;
};

export type PlaybookCardRow = {
  id: string;
  key: string;
  title: string;
  criteria: string | null;
  say: string | null;
  why: string | null;
  active: boolean;
  sort: number;
};

export type CoachCardRow = {
  id: string;
  call_id: string;
  segment_id: string | null;
  source: 'jev' | 'claude';
  card_key: string;
  confidence: number | null;
  runner_up_key: string | null;
  runner_up_probability: number | null;
  dnc_p: number | null;
  latency_ms: number | null;
  action: CoachAction | null;
  created_at: string;
};

export type CallbackRow = {
  id: string;
  lead_id: string;
  due_at: string;
  done_at: string | null;
  note: string | null;
  created_at: string;
};

export type CmaRow = {
  id: string;
  lead_id: string | null;
  address: string;
  subject: Record<string, unknown>;
  comps: unknown[];
  actives: unknown[];
  price_range: Record<string, unknown> | null;
  time_window: string | null;
  radius_miles: number | null;
  notes: string | null;
  favor_note: string | null;
  weigh_note: string | null;
  published_slug: string | null;
  published_at: string | null;
  credits_used: number;
  created_at: string;
};

/** `path` is the object key in the private `vm-drops` storage bucket. */
export type VoicemailDrop = { id: string; label: string; path: string };

export type SettingsRow = {
  id: 1;
  caller_id: string | null;
  hours: Hours;
  max_rounds: number;
  round_gap_hours: number;
  ring_timeout_s: number;
  outcomes: string[];
  voicemail_drops: VoicemailDrop[];
};

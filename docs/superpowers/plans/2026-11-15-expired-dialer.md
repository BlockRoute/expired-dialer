# Expired Dialer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-user web app where Daniel imports a purchased expired-listing list, cold-calls owners one at a time from his browser, gets Jev-routed coaching cards and a quick sold-comp CMA during the call, and publishes a seller CMA page afterwards.

**Architecture:** Next.js 16 app on Netlify with Supabase (Postgres/Auth/Storage). Calls run in the browser via the Twilio Voice JS SDK; every dial passes a server-side guardrail in the TwiML voice route. The browser streams mic and owner audio to Deepgram; owner turns go to `/api/coach`, which asks TypeSafe (Jev) to pick a playbook card and check for a DNC request. Pure logic (guardrails, queue order, import mapping, card decisions, CMA math) lives in `lib/` with vitest coverage; routes and UI are thin.

**Tech Stack:** Next.js 16.2 / React 19 / Tailwind v4 / TypeScript, pnpm, Supabase (`@supabase/ssr`, `@supabase/supabase-js`), `@twilio/voice-sdk` + `twilio` (server), Deepgram live WebSocket API, TypeSafe HTTP API (`jev-latest`), `@anthropic-ai/sdk`, RealtyAPI (`zillow.realtyapi.io`), `xlsx`, `zod`, Leaflet 1.9.4 (CDN on the seller page only), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-expired-dialer-design.md` — read it alongside this plan.

## Global Constraints

- Repo: `~/expired-dialer`, package manager pnpm. Next 16 uses `proxy.ts`, not `middleware.ts`; check `node_modules/next/dist/docs/` before relying on remembered Next APIs.
- Copy (don't import) from `~/foothold`: `lib/ai/anthropic.ts`, `lib/supabase/{client,server,admin,proxy,config}.ts`, `lib/server/api-errors.ts`, `proxy.ts`, `vitest.config.ts`. Strip org logic (`ORG_COOKIE`, `requireOrg`); keep `requireUser`.
- `lib/comps/realty.ts` in Foothold is Redfin-based. Reuse only its fetch pattern (`x-realtyapi-key` header, `AbortSignal.timeout(20_000)`, `cache: 'no-store'`); the CMA follows the comp-map skill's Zillow flow (Task 12).
- Secrets server-side only: `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN`, `TWILIO_TWIML_APP_SID`, `TWILIO_CALLER_ID` (new 804 Twilio number, E.164), `DANIEL_CELL`, `DEEPGRAM_API_KEY`, `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY`, `REALTYAPI_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`. Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Single user: magic link for one allowed email (`ALLOWED_EMAIL`), all other emails rejected server-side; RLS policy `auth.email() = <allowed>` on every table except public CMA reads.
- Virginia owners only. Hard calling bound 08:00–21:00 America/New_York; default window Mon–Sat 09:00–20:00, Sunday closed; editable only within the hard bound.
- Retry defaults: max 3 attempt rounds per lead, ≥24h between rounds, ring timeout 25s; lead with no outcome after max rounds → `dead`.
- DNC: vendor-flagged or internal-DNC phones never dialable; phones with no DNC flag (or Jev `unknown`) blocked until batch is marked vendor-scrubbed with a scrub date; every phone in a batch blocked when scrub date is more than 90 days old.
- Recording: every call `record="record-from-answer-dual"`; both sides transcribed.
- Jev: model `jev-latest`; card shown alone at confidence ≥0.6, top-two below 0.6; DNC Noul threshold 0.5; Claude fallback card only when Jev says `none` and the owner turn has ≥6 words; at most one card per owner turn; drop stale responses.
- Claude models: fast `claude-haiku-5-5` (fallback cards), strong `claude-sonnet-5-5` (summaries, CMA notes). Confirm IDs with the claude-api skill before Task 10.
- All Twilio webhooks verify `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN` against `APP_URL` + path.
- Seller CMA page: `noindex` meta + `X-Robots-Tag: noindex`, Manrope, comp-map skill tokens and copy rules (no em-dashes, no exclamation marks, numbers first), footer `eXp Realty · Seller Representative Specialist (SRS) · danielyoonrealty.com`, never "Luxury Division".
- No Zestimate or other vendor AVM used as a value. No Fraunces, no Anthropic/Claude-styled visuals in the app.
- Tests: vitest `lib/**/*.test.ts`; network (Twilio, Deepgram, TypeSafe, Anthropic, RealtyAPI) is mocked in unit tests. `pnpm jev:regress` is the only test that hits TypeSafe for real.

## Review Focus

1. **Re-importing a list after Daniel worked it** — a phone he marked `dead`/`wrong`, or a lead he marked `dnc`, must stay that way; the import only updates listing fields and adds new phones. Test in Task 4.
2. **Clock edges** — a dial at 20:59:40 with a 25s ring, the DST switch days, and Sunday must evaluate in America/New_York regardless of server TZ (Netlify runs UTC). Test in Task 5.
3. **Same phone on two leads / messy phone text** — `(804) 555-0142`, `804.555.0142`, `8045550142 x12`, `555-0142` (no area code), and an international number: normalize or reject, and an internal-DNC number blocks every lead it appears on. Tests in Tasks 3 and 5.
4. **Coaching services failing mid-call** — Deepgram socket closes, TypeSafe 429/529/timeout, Claude error: the call and transcript continue, the panel shows a quiet "coaching paused" state, no thrown error reaches the call UI. Test in Task 10.
5. **Twilio callbacks arriving twice or out of order** — `completed` before `in-progress`, a duplicate recording callback: call rows update idempotently and never regress status or overwrite a saved outcome. Test in Task 7.

---

## File Structure

```
app/
  (auth)/login/page.tsx              magic-link form
  auth/callback/route.ts             exchange code, reject non-allowed email
  (app)/layout.tsx                   nav: Dialer, Leads, Callbacks, Settings
  (app)/leads/page.tsx               lead table
  (app)/leads/[id]/page.tsx          lead detail + timeline
  (app)/import/page.tsx              upload → map → preview → import
  (app)/import/actions.ts            server actions for import
  (app)/dialer/page.tsx              server shell
  (app)/dialer/dialer.tsx            client: Device, queue, outcome bar
  (app)/dialer/coach-panel.tsx       client: audio→Deepgram, cards
  (app)/dialer/cma-panel.tsx         client: quick CMA
  (app)/callbacks/page.tsx
  (app)/settings/page.tsx            hours, retries, outcomes, VM drops, DNC list
  (app)/settings/playbook/page.tsx   cards CRUD, test-this-card, most-overridden
  (app)/cma/[id]/page.tsx            CMA editor
  c/[slug]/page.tsx                  public seller CMA page
  api/twilio/token/route.ts
  api/twilio/voice/route.ts          TwiML + guardrail
  api/twilio/status/route.ts
  api/twilio/recording/route.ts
  api/twilio/inbound/route.ts
  api/twilio/vm-drop/route.ts
  api/deepgram/token/route.ts
  api/coach/route.ts
  api/calls/[id]/segments/route.ts
  api/calls/[id]/finish/route.ts     post-call pre-fill + summary
  api/cma/route.ts                   quick CMA for a lead
lib/
  phone.ts, address.ts, time.ts
  import/{parse,mapping,build}.ts
  guardrails.ts, queue.ts
  twilio/{client,twiml,signature}.ts
  typesafe/{client,questions}.ts
  coach/{decide,playbook-default}.ts
  postcall/prefill.ts
  cma/{zillow,select,value}.ts
  db/types.ts                        row types shared by routes and UI
supabase/migrations/0001_init.sql
scripts/jev-regress.ts
```

---

### Task 1: Scaffold, auth and schema

**Files:**
- Create: Next app (`pnpm create next-app@16 . --ts --tailwind --app --eslint --use-pnpm`), copied Foothold files per Global Constraints, `app/(auth)/login/page.tsx`, `app/auth/callback/route.ts`, `app/(app)/layout.tsx`, `supabase/migrations/0001_init.sql`, `lib/db/types.ts`, `netlify.toml`, `.env.example`, `README.md`
- Test: `lib/auth.test.ts`

**Interfaces:**
- Produces: `requireUser(): Promise<User>` (redirects to `/login`), `isAllowedEmail(email: string | null | undefined): boolean` in `lib/auth.ts`; row types in `lib/db/types.ts` named `LeadRow`, `PhoneRow`, `CallRow`, `TranscriptSegmentRow`, `CoachCardRow`, `CallbackRow`, `CmaRow`, `PlaybookCardRow`, `ImportMappingRow`, `ImportBatchRow`, `SettingsRow`, `DncNumberRow`.

Schema (one migration, columns per spec §10 plus these exact enums/defaults):
- `leads.status` check in (`new`,`working`,`callback`,`appointment`,`dead`,`dnc`,`out_of_state`) default `new`; `leads.attempt_rounds int default 0`; `leads.next_eligible_at timestamptz`; `leads.normalized_address text unique`; `leads.state text`; `leads.mailing_state text`.
- `phones.status` in (`ok`,`dead`,`wrong`) default `ok`; `phones.vendor_dnc` in (`do_not_call`,`callable`,`unknown`); `phones.number` E.164; unique (`lead_id`,`number`).
- `import_batches.scrubbed_by_vendor bool default false`, `scrub_date date`.
- `calls.status` in (`queued`,`ringing`,`in-progress`,`completed`,`busy`,`no-answer`,`failed`,`canceled`); `calls.outcome text`; `calls.outcome_saved_at timestamptz`; `calls.twilio_parent_sid text unique`, `twilio_child_sid text`.
- `settings` single row id=1 with defaults: `hours jsonb` Mon–Sat `["09:00","20:00"]`, Sun `null`; `max_rounds 3`; `round_gap_hours 24`; `ring_timeout_s 25`; `outcomes jsonb` = `["connected","no_answer","left_vm","bad_number","wrong_person","dnc","appointment_set","callback_requested","not_interested","relisted_elsewhere","off_market_or_sold"]`.
- Storage buckets: `vm-drops` (private), `recordings` (private).
- RLS on every table: `using (auth.email() = current_setting('app.allowed_email'))` — set `app.allowed_email` via `alter database ... set` in the migration from a placeholder documented in README. `cmas` additionally allows anon `select` where `published_slug is not null`.

- [ ] **Step 1: Scaffold and copy Foothold files; `pnpm build` passes** — the repo already holds `docs/`, `experiments/` and `.gitignore`, so scaffold into a temp dir and move the app files in (create-next-app refuses a non-empty target); merge `.gitignore`; `git init` and commit the existing docs first.
- [ ] **Step 2: Write failing test** `isAllowedEmail` — `expect(isAllowedEmail('dyoonrealty@gmail.com')).toBe(true)` with `ALLOWED_EMAIL` set to that, case-insensitive (`'DYoonRealty@Gmail.com'` true), `'x@y.com'` false, `undefined` false.
- [ ] **Step 3: Implement `lib/auth.ts`; callback route signs out and redirects to `/login?error=not-allowed` when not allowed**
- [ ] **Step 4: `pnpm test` passes; apply migration to a new Supabase project; `pnpm dev`, log in, see empty app shell**
- [ ] **Step 5: Commit** `feat: scaffold app, single-user auth, schema`

README lists every env var and the one-time manual steps from spec §6 (Twilio number purchase, API key, TwiML App pointing Voice URL to `${APP_URL}/api/twilio/voice`, number Voice webhook to `/api/twilio/inbound`, Trust Hub profile, SHAKEN/STIR, CNAM).

---

### Task 2: Phones, addresses and time

**Files:**
- Create: `lib/phone.ts`, `lib/address.ts`, `lib/time.ts`
- Test: `lib/phone.test.ts`, `lib/address.test.ts`, `lib/time.test.ts`

**Interfaces:**
- Produces:
  - `normalizePhone(raw: string): string | null` → `+1XXXXXXXXXX` for valid NANP 10-digit numbers (strip punctuation, leading `1`, trailing `x\d+` extensions); null otherwise.
  - `normalizeAddress(street: string, zip: string | null): string` — uppercase, collapse whitespace, strip punctuation, standard suffix/direction abbreviations (AVENUE→AVE, STREET→ST, ROAD→RD, DRIVE→DR, COURT→CT, LANE→LN, BOULEVARD→BLVD, NORTH→N, SOUTH→S, EAST→E, WEST→W), then `" " + zip5`.
  - `easternParts(at: Date): { weekday: 0-6; minutes: number; date: string }` using `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' })`.

- [ ] **Step 1: Write failing tests**
  - `normalizePhone('(804) 555-0142')`, `'804.555.0142'`, `'1-804-555-0142'`, `'8045550142 x12'` all `'+18045550142'`; `'555-0142'` null; `'+44 20 7946 0958'` null; `''` null.
  - `normalizeAddress('4417 Grove Avenue', '23221-1234') === normalizeAddress('4417 GROVE AVE.', '23221')`.
  - `easternParts(new Date('2026-03-08T07:00:00Z'))` → minutes 180 (03:00 EDT, the instant after spring-forward), `easternParts(new Date('2026-11-01T06:30:00Z'))` → minutes 90 (01:30 EST, the repeated hour's second pass); `easternParts(new Date('2026-11-15T15:00:00Z')).weekday === 0`.
- [ ] **Step 2: Run, verify FAIL** `pnpm vitest run lib/phone.test.ts lib/address.test.ts lib/time.test.ts`
- [ ] **Step 3: Implement the three modules**
- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit** `feat: phone, address and eastern-time helpers`

---

### Task 3: TypeSafe client and question builders

**Files:**
- Create: `lib/typesafe/client.ts`, `lib/typesafe/questions.ts`, `lib/coach/playbook-default.ts`, `scripts/jev-regress.ts`
- Test: `lib/typesafe/client.test.ts`, `lib/typesafe/questions.test.ts`
- Modify: `package.json` (script `"jev:regress": "tsx scripts/jev-regress.ts"`)

**Interfaces:**
- Produces:
  - `type JevQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> } | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }`
  - `type JevAnswers = Record<string, { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> } | { type: 'noul'; noul: number }>`
  - `jev(state: unknown, questions: Record<string, JevQuestion>, opts?: { timeoutMs?: number }): Promise<JevAnswers>` — POST `https://api.typesafe.ai/v1/systemone`, model `jev-latest`, `Authorization: Bearer ${TYPESAFE_API_KEY}`, retry 429/529 with backoff 250ms/500ms/1000ms, default timeout 3000ms, throws `JevError` otherwise. (Plain fetch instead of the JS SDK: the experiments proved this exact HTTP shape; spec deviation noted.)
  - In `questions.ts`, wording copied verbatim from `experiments/typesafe/run.py` and `followup.py`: `DNC_REQUEST_INSTRUCTIONS`, `dncRequestNoul(path: 'owner_said' | 'transcript'): JevQuestion`, `cardChoice(cards: Pick<PlaybookCardRow,'key'|'criteria'>[], withContext: boolean): JevQuestion` (always adds `none` = run.py's `none` criteria), `outcomeChoice(outcomes: Record<string,string>)`, `appointmentNoul()`, `callbackTimeNoul()`, `columnFieldChoice(fields: Record<string,string>)`, `dncColumnNoul()`, `dncValueChoice()`.
  - `DEFAULT_PLAYBOOK: { key; title; criteria; say; why? }[]` — the 14 cards from spec §8, using `run.py` PLAYBOOK criteria with the four revised definitions from the 36/36 retest (call_me_later, timing_not_ready, taking_off_market, not_interested). Seed into `playbook_cards` via migration `0002_seed_playbook.sql` generated from this constant.
  - `scripts/jev-regress.ts`: replays the 36 coaching cases, 10 outcome cases and 21 columns from the experiments against the live API using the builders above; prints accuracy; exits 1 if card accuracy < 0.9 or any DNC-request case is wrong.

- [ ] **Step 1: Write failing tests** — client: mocked `fetch` returns 429 twice then 200 → resolves after 3 calls; 401 → throws `JevError` with status 401; request body has `model: 'jev-latest'`. Questions: `cardChoice([...], true).criteria` contains every card key plus `none`; `dncRequestNoul('transcript').instructions` contains "`transcript`" and "NOT a request to stop calling".
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run unit tests PASS; run `TYPESAFE_API_KEY=… pnpm jev:regress` and verify it prints card accuracy ≥0.9 and DNC 36/36**
- [ ] **Step 5: Commit** `feat: TypeSafe client, question builders, default playbook`

---

### Task 4: Import — parse, map, build, apply

**Files:**
- Create: `lib/import/parse.ts`, `lib/import/mapping.ts`, `lib/import/build.ts`, `app/(app)/import/page.tsx`, `app/(app)/import/actions.ts`
- Test: `lib/import/build.test.ts`, `lib/import/mapping.test.ts`

**Interfaces:**
- Consumes: `normalizePhone`, `normalizeAddress` (Task 2); `jev`, `columnFieldChoice`, `dncColumnNoul`, `dncValueChoice` (Task 3).
- Produces:
  - `parseSheet(data: ArrayBuffer, filename: string): { headers: string[]; rows: Record<string, string>[] }` (xlsx for .xlsx/.xls/.csv; all cells as trimmed strings).
  - `type FieldKey = 'owner_full_name'|'owner_first_name'|'owner_last_name'|'property_address'|'property_city'|'property_state'|'property_zip'|'mailing_address'|'mailing_state'|'list_price'|'original_price'|'days_on_market'|'price_cuts'|'expired_date'|'listing_office'|'phone'|'phone_type'|'phone_dnc'|'scrub_date'|'email'|'mls_number'|'ignore'`
  - `type ColumnTarget = { field: FieldKey; slot?: number }` (slot groups phone/phone_type/phone_dnc columns, 1-based).
  - `type VendorMapping = { vendor: string; columns: Record<string, ColumnTarget>; dncValues: Record<string, 'do_not_call'|'callable'|'unknown'> }`
  - `inferSlot(header: string): number | undefined` — first integer in the header (`"Phone 1 DNC"`→1, `"Ph2 Status"`→2).
  - `suggestMapping(headers: string[], rows: Record<string,string>[]): Promise<{ columns: Record<string, ColumnTarget & { confidence: number }>; dncColumnFlags: Record<string, number> }>` — one Jev request per column (parallel, max 6 in flight) with 5 sample values.
  - `unmappedDncColumns(mapping: VendorMapping, flags: Record<string, number>): string[]` — headers with flag ≥0.5 whose target is `ignore` or missing.
  - `buildLeads(rows, mapping): { leads: ImportedLead[]; skipped: { row: number; reason: 'no_address'|'no_valid_phone' }[] }` where `ImportedLead = { normalizedAddress; fields: Partial<LeadRow>; phones: { number: string; position: number; lineType: 'mobile'|'landline'|'voip'|null; vendorDnc: 'do_not_call'|'callable'|'unknown' }[]; outOfState: boolean }`. Line type values `W`, `Wireless`, `Mobile`, `Cell` → mobile; `L`, `Landline` → landline; `VoIP` → voip. Phones sorted mobile first, then by slot. `outOfState` when property or mailing state is present and not `VA`/`Virginia`.
  - Server action `applyImport(batchId: string, leads: ImportedLead[]): Promise<{ created: number; updated: number; phonesAdded: number; dncPhones: number }>` — upsert by `normalized_address`; on existing lead update listing fields only, never `status` if it is `dnc`/`dead`/`appointment`; insert phones with `on conflict (lead_id, number) do nothing`; new out-of-state leads get status `out_of_state`.
- UI flow: upload → if vendor name has a saved mapping, preview; else run `suggestMapping` and show a mapping table with confidence; block Save while `unmappedDncColumns` is non-empty unless each is dismissed; show distinct DNC values with Jev's reading (`dncValueChoice`) for confirmation; batch form has a "Scrubbed by vendor" checkbox and a **required** scrub date (prefilled from a mapped `scrub_date` column's most common value, else Daniel enters the date the vendor scrubbed, usually the purchase date). `import_batches.scrub_date` is `not null`.

- [ ] **Step 1: Write failing tests (build)**
  - Row with `Phone 1`=`(804) 555-0142`, `Phone 1 Type`=`L`, `Phone 2`=`8045550199`, `Phone 2 Type`=`W` → phones ordered `+18045550199` (mobile) then `+18045550142`.
  - DNC column value `Y` with `dncValues {Y:'do_not_call'}` → `vendorDnc 'do_not_call'`; blank or unlisted value → `'unknown'`.
  - Mailing state `MD` → `outOfState: true`.
  - Row with only `555-0142` → skipped `no_valid_phone`.
- [ ] **Step 2: Write failing tests (mapping)** — `inferSlot('Ph2 Status') === 2`; `unmappedDncColumns({columns:{'Ph2 Status':{field:'ignore'}}}, {'Ph2 Status':0.72})` → `['Ph2 Status']`; mapped to `phone_dnc` → `[]`.
- [ ] **Step 3: Write failing test for Review Focus 1** (apply logic extracted as pure `mergeLead(existing: LeadRow, incoming: ImportedLead): Partial<LeadRow>` in `build.ts`): existing `status:'dnc'` stays `dnc`; existing `status:'dead'` stays `dead`; `list_price` updates.
- [ ] **Step 4: Run, verify FAIL**
- [ ] **Step 5: Implement modules, page and actions**
- [ ] **Step 6: Run tests PASS; manually import `experiments/typesafe` E3-style sample CSV (create `fixtures/sample-vendor.csv` from E3_COLUMNS) and see counts**
- [ ] **Step 7: Commit** `feat: vendor list import with Jev-suggested mapping`

---

### Task 5: Guardrails and queue order

**Files:**
- Create: `lib/guardrails.ts`, `lib/queue.ts`
- Test: `lib/guardrails.test.ts`, `lib/queue.test.ts`

**Interfaces:**
- Consumes: `easternParts` (Task 2); row types.
- Produces:
  - `type BlockReason = 'vendor_dnc'|'internal_dnc'|'unscrubbed'|'scrub_stale'|'outside_hours'|'out_of_state'|'lead_closed'|'phone_dead'|'cooldown'|'max_rounds'`
  - `checkDial(input: { lead: LeadRow; phone: PhoneRow; batch: ImportBatchRow; internalDnc: boolean; settings: SettingsRow; now: Date }): { ok: true } | { ok: false; reason: BlockReason }` — checks in this order: internal_dnc, vendor_dnc, unscrubbed (`vendor_dnc==='unknown' && !batch.scrubbed_by_vendor`), scrub_stale (`batch.scrub_date` more than 90 days before `now`; every batch has a scrub date, see Task 4), out_of_state, lead_closed (status `dnc`/`dead`/`appointment`/`out_of_state`), phone_dead (status ≠ `ok`), max_rounds, cooldown (`next_eligible_at > now`), outside_hours (Eastern window from settings intersected with 08:00–21:00; the dial must start no later than `21:00 − ring_timeout_s`).
  - `orderQueue(leads: (LeadRow & { dueCallbackAt: string | null })[], now: Date): LeadRow[]` — due callbacks (oldest due first), then `attempt_rounds = 0` by `expired_date` desc, then eligible retries by `next_eligible_at` asc; excludes closed statuses.
  - `afterRound(lead: LeadRow, settings: SettingsRow, now: Date): Pick<LeadRow,'attempt_rounds'|'next_eligible_at'|'status'>` — increments rounds, sets `next_eligible_at = now + round_gap_hours`, status `dead` when rounds reach `max_rounds`.

- [ ] **Step 1: Write failing tests**
  - internal DNC beats everything; vendor `do_not_call` blocked; `unknown` + unscrubbed batch → `unscrubbed`; `unknown` + scrubbed batch 30 days old → ok; scrub 91 days old → `scrub_stale`; exactly 90 days → ok.
  - Saturday 19:59:00 Eastern ok; Sunday 12:00 → `outside_hours`; a settings row holding 07:00–22:00 (bypassing `validateHours`) still blocks 07:30 and 20:59:40; with window 09:00–21:00 and 25s ring, 20:59:34 ok and 20:59:36 blocked (last start = 20:59:35).
  - Server TZ independence: run the hours tests with `process.env.TZ = 'UTC'` and `'America/Los_Angeles'` (set in test) and get identical results.
  - `orderQueue`: due callback first even if newer leads exist; `out_of_state` lead excluded.
  - `afterRound` with rounds=2, max 3 → status `dead`.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit** `feat: dial guardrails and queue ordering`

---

### Task 6: Twilio token and voice route

**Files:**
- Create: `lib/twilio/client.ts`, `lib/twilio/signature.ts`, `lib/twilio/twiml.ts`, `app/api/twilio/token/route.ts`, `app/api/twilio/voice/route.ts`
- Test: `lib/twilio/twiml.test.ts`, `lib/twilio/signature.test.ts`

**Interfaces:**
- Consumes: `checkDial`, `requireUser`.
- Produces:
  - `voiceToken(identity: 'daniel'): string` — `twilio.jwt.AccessToken` with `VoiceGrant({ outgoingApplicationSid: TWILIO_TWIML_APP_SID, incomingAllow: false })`, TTL 3600.
  - `verifyTwilioRequest(request: Request, params: Record<string,string>): boolean` using `twilio.validateRequest`.
  - `dialTwiml(opts: { to: string; callerId: string; callId: string; ringTimeoutS: number }): string` → `<Response><Dial callerId=… timeout=… record="record-from-answer-dual" recordingStatusCallback="${APP_URL}/api/twilio/recording?callId=…" action="${APP_URL}/api/twilio/status?callId=…&leg=dial"><Number statusCallbackEvent="initiated ringing answered completed" statusCallback="${APP_URL}/api/twilio/status?callId=…&leg=child">…</Number></Dial></Response>`.
  - `rejectTwiml(reason: BlockReason): string` → `<Response><Say>…</Say><Hangup/></Response>` (Say text is for Daniel's ear only: "Blocked: <reason in words>").
  - Voice route: params `To`, `LeadId`, `PhoneId` from `device.connect({ params })`; loads rows with admin client; runs `checkDial`; on ok inserts `calls` row (`queued`, parent sid = `CallSid`) and returns `dialTwiml`; on block returns `rejectTwiml` and inserts nothing.

- [ ] **Step 1: Write failing tests** — `dialTwiml` output contains `record="record-from-answer-dual"`, `timeout="25"`, the callerId, and XML-escapes a `&` in `APP_URL`; `rejectTwiml('vendor_dnc')` contains `<Hangup/>`; `verifyTwilioRequest` true for a fixture signed with a known token, false when one param changes.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests PASS**
- [ ] **Step 5: Commit** `feat: twilio access token and guarded voice route`

---

### Task 7: Call status, recordings, inbound, voicemail drop

**Files:**
- Create: `app/api/twilio/status/route.ts`, `app/api/twilio/recording/route.ts`, `app/api/twilio/inbound/route.ts`, `app/api/twilio/vm-drop/route.ts`, `lib/twilio/status.ts`
- Test: `lib/twilio/status.test.ts`

**Interfaces:**
- Consumes: `verifyTwilioRequest`, `normalizePhone`.
- Produces:
  - `nextCallState(current: CallRow, event: { status: CallRow['status']; at: string; childSid?: string; answeredBy?: string }): Partial<CallRow> | null` — status rank `queued<ringing<in-progress<terminal`; never moves backwards; terminal states are final; sets `answered_at` on first `in-progress`, `ended_at` on first terminal; returns null when nothing changes; never touches `outcome`.
  - Recording route: idempotent on `RecordingSid`; downloads the mp3 with account auth and stores `recordings/<callId>.mp3`; sets `calls.recording_path`.
  - Inbound route: `<Dial>` to `DANIEL_CELL` with `callerId` = original caller; inserts a `calls` row with `direction 'inbound'`, linked to a lead when `normalizePhone(From)` matches a phone.
  - VM drop route (POST, user-auth): `{ callId, dropId }` → Twilio REST `calls(childSid).update({ twiml: <Play>signed-url</Play><Hangup/> })`, then `calls(parentSid).update({ status: 'completed' })`; sets outcome `left_vm`. Signed URL from `vm-drops` bucket, 10-minute expiry.

- [ ] **Step 1: Write failing tests (Review Focus 5)** — `completed` then late `in-progress` → second returns null; duplicate `completed` → null; `ringing` on a row with saved outcome leaves outcome untouched; first `in-progress` sets `answered_at`.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run PASS**
- [ ] **Step 5: Commit** `feat: twilio status, recordings, inbound forwarding, voicemail drop`

---

### Task 8: Dialer screen, outcomes and callbacks

**Files:**
- Create: `app/(app)/dialer/page.tsx`, `app/(app)/dialer/dialer.tsx`, `app/(app)/dialer/actions.ts`, `app/(app)/callbacks/page.tsx`, `app/(app)/leads/page.tsx`, `app/(app)/leads/[id]/page.tsx`, `lib/outcomes.ts`
- Test: `lib/outcomes.test.ts`, `e2e/dialer.spec.ts`

**Interfaces:**
- Consumes: `orderQueue`, `afterRound`, `checkDial` (for UI preview badges), token route, VM drop route.
- Produces:
  - `applyOutcome(input: { outcome: string; lead: LeadRow; phone: PhoneRow; settings: SettingsRow; now: Date; callbackAt?: string }): { lead: Partial<LeadRow>; phone?: Partial<PhoneRow>; addInternalDnc?: string; callback?: { due_at: string }; advance: 'next_phone'|'next_lead' }` —
    `no_answer` → next_phone (if phones remain, else `afterRound` + next_lead); `bad_number` → phone `dead`, next_phone; `wrong_person` → phone `wrong`, next_phone; `dnc` → lead `dnc`, addInternalDnc = phone.number, next_lead; `appointment_set` → lead `appointment`; `callback_requested` → lead `callback` + callback row; `left_vm`/`not_interested`/`relisted_elsewhere`/`off_market_or_sold`/`connected` → `afterRound`, next_lead (`not_interested`, `relisted_elsewhere`, `off_market_or_sold` set lead `dead`).
  - Server action `saveOutcome(callId: string, outcome: string, note: string, callbackAt?: string)` — writes `calls.outcome`, `outcome_saved_at`, applies `applyOutcome` in one transaction (RPC `save_outcome` in migration `0003_save_outcome.sql`).
  - Dialer client: `Device` registered with token; `device.connect({ params: { To, LeadId, PhoneId } })`; outcome bar per spec §5 sketch; keyboard 1–6 for outcomes, `N` next; shows block reason badge when `checkDial` would fail (server remains the authority).

- [ ] **Step 1: Write failing tests for `applyOutcome`** — each outcome's mapping above; `dnc` returns `addInternalDnc` equal to the phone number; `no_answer` on last phone triggers `afterRound`.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement `lib/outcomes.ts`, RPC, actions, pages**
- [ ] **Step 4: Unit tests PASS; Playwright `e2e/dialer.spec.ts` with a stubbed `window.Twilio.Device` (inject via `page.addInitScript`) walks: load queue → call → mark No answer → advances to phone 2 → mark DNC → lead moves to DNC and the next lead loads**
- [ ] **Step 5: Real smoke test: Daniel calls his own cell from the app; recording appears on the lead timeline**
- [ ] **Step 6: Commit** `feat: dialer screen, outcomes, callbacks`

---

### Task 9: Live transcription in the browser

**Files:**
- Create: `app/api/deepgram/token/route.ts`, `app/api/calls/[id]/segments/route.ts`, `app/(app)/dialer/use-transcription.ts`, `lib/transcript.ts`
- Test: `lib/transcript.test.ts`

**Interfaces:**
- Consumes: Twilio `Call` from Task 8 (`call.getLocalStream()`, `call.getRemoteStream()`).
- Produces:
  - Token route: `POST https://api.deepgram.com/v1/auth/grant` with `DEEPGRAM_API_KEY`, `ttl_seconds: 60`; returns `{ accessToken }`. Builder confirms endpoint in current Deepgram docs.
  - `useTranscription(call: Call | null): { segments: Segment[]; status: 'idle'|'live'|'paused'; onOwnerTurn: (cb: (turn: OwnerTurn) => void) => void }` — two WebSockets to `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&interim_results=true&utterance_end_ms=1000&vad_events=true&smart_format=true` (one per stream, speaker known by stream). Audio via an `AudioWorklet` downsampling to 16 kHz PCM16. Reconnect once on close, then `paused`.
  - `type Segment = { speaker: 'rep'|'owner'; text: string; tStart: number; tEnd: number; final: boolean }`; `type OwnerTurn = { ownerSaid: string; transcriptSoFar: string; turnId: number }`.
  - `buildOwnerTurn(segments: Segment[], turnId: number, windowS = 90): OwnerTurn` in `lib/transcript.ts` — `ownerSaid` = owner final segments since the last rep segment; `transcriptSoFar` = labeled `Rep:`/`Owner:` lines within the last 90s ending with the rep's last line (excludes `ownerSaid`).
  - Segments route: append final segments to `transcript_segments` (batch POST every 2s).

- [ ] **Step 1: Write failing tests for `buildOwnerTurn`** — interleaved fixture: `ownerSaid` joins only owner finals after the last rep final; `transcriptSoFar` ends with `Rep: <last rep line>`; segments older than 90s are dropped; interim segments ignored.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Tests PASS; smoke call to own cell shows both sides transcribing within ~1s**
- [ ] **Step 5: Commit** `feat: in-browser dual-stream transcription`

---

### Task 10: Coaching route and panel

**Files:**
- Create: `lib/coach/decide.ts`, `app/api/coach/route.ts`, `app/(app)/dialer/coach-panel.tsx`, `lib/coach/render.ts`
- Test: `lib/coach/decide.test.ts`, `lib/coach/render.test.ts`, `app/api/coach/route.test.ts` (add `app/**/*.test.ts` to vitest include)

**Interfaces:**
- Consumes: `jev`, `cardChoice`, `dncRequestNoul` (Task 3); `OwnerTurn` (Task 9); `runClaude` (copied wrapper).
- Produces:
  - `decideCards(answer: { choice: string; confidence: number; probabilities: Record<string, number> }, ownerSaid: string): { mode: 'single'; keys: [string] } | { mode: 'pair'; keys: [string, string] } | { mode: 'none' } | { mode: 'fallback' }` — `none` top + ≥6 words → fallback; `none` top otherwise → none; confidence ≥0.6 → single; else pair of top two (excluding `none`).
  - `renderSay(say: string, lead: LeadRow, cma: { low: number; high: number } | null): string` — replaces `%lead.first_name%`, `%lead.list_price%` (formatted `$425k`), `%lead.days_on_market%`, `%cma.range%` (`$395k–$415k`); unknown variables render as empty and are trimmed.
  - `POST /api/coach` body `{ callId, leadId, turn: OwnerTurn }` → `{ turnId, cards: { key: string; title: string; say: string; why?: string; source: 'jev'|'claude' }[], dncP: number, latencyMs: number }`. One `jev` call with questions `card` + `dnc` (state per spec §8). On fallback, `runClaude` with model `claude-haiku-5-5`, `maxTokens: 200`, a byte-stable system prompt, returning JSON `{title, say, why}` (`say` ≤20 words); label source `claude`. Inserts a `coach_cards` row. On any upstream error returns `200 { turnId, cards: [], dncP: null, paused: true }`.
  - Coach panel: calls the route on each `onOwnerTurn`; ignores responses whose `turnId` < latest; renders single card or two compact options; "Use"/"Dismiss"/"Switch" buttons update `coach_cards.action`; `dncP ≥ 0.5` shows the DNC banner and tells the dialer to preselect the `dnc` outcome (saving another outcome requires an override click).

- [ ] **Step 1: Write failing tests** — `decideCards`: `{choice:'buying_signal', confidence:0.56, probabilities:{buying_signal:.56, commission_objection:.4, none:.04}}` → pair `['buying_signal','commission_objection']`; `none` 0.9 with "uh" → none; `none` 0.8 with a 9-word line → fallback; 0.91 → single. `renderSay('Hi %lead.first_name%, %cma.range%', {first_name:'Jane'}, {low:395000, high:415000})` → `'Hi Jane, $395k–$415k'`.
- [ ] **Step 2: Write failing route test (Review Focus 4)** — mock `jev` to reject with `JevError(529)` after retries → response 200 with `paused: true` and no throw; mock Claude throwing on fallback → returns `cards: []`, still 200.
- [ ] **Step 3: Run, verify FAIL**
- [ ] **Step 4: Implement**
- [ ] **Step 5: Tests PASS; smoke call: say "we're going to relist with Susan" from the cell and see the relisting card within ~1s**
- [ ] **Step 6: Commit** `feat: Jev-routed live coaching cards and DNC banner`

---

### Task 11: Post-call pre-fill and summary

**Files:**
- Create: `lib/postcall/prefill.ts`, `app/api/calls/[id]/finish/route.ts`
- Modify: `app/(app)/dialer/dialer.tsx` (pre-select outcome, open callback picker), `app/(app)/leads/[id]/page.tsx` (show summary)
- Test: `lib/postcall/prefill.test.ts`

**Interfaces:**
- Consumes: `jev`, `outcomeChoice`, `appointmentNoul`, `callbackTimeNoul`, `dncRequestNoul('transcript')`; `runClaude`.
- Produces:
  - `prefillFromAnswers(a: JevAnswers): { outcome: string; openCallbackPicker: boolean; dncSuggested: boolean }` — `dnc` ≥0.5 overrides outcome to `dnc`; `appointment` ≥0.5 and outcome not `dnc` → `appointment_set`; `callback_time` ≥0.5 → `openCallbackPicker`.
  - `POST /api/calls/[id]/finish` → runs the Jev request (state `{ transcript }`, outcome criteria = `run.py` E2 `OUTCOMES` with keys mapped to settings outcomes: `do_not_call`→`dnc`, `voicemail_or_machine`→`left_vm`, the rest unchanged) and returns prefill within one response; then (not awaited by the client) runs `runClaude` with `claude-sonnet-5-5` to write `{ summary, note, next_step }` into `calls.ai_summary`. Skips both when the call had no owner speech.

- [ ] **Step 1: Write failing tests** — dnc 0.97 + outcome `callback_requested` → outcome `dnc`, `dncSuggested`; appointment 0.9 → `appointment_set`; callback_time 0.8 → picker opens.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Tests PASS**
- [ ] **Step 5: Commit** `feat: post-call outcome pre-fill and AI summary`

---

### Task 12: Quick CMA

**Files:**
- Create: `lib/cma/zillow.ts`, `lib/cma/select.ts`, `lib/cma/value.ts`, `app/api/cma/route.ts`, `app/(app)/dialer/cma-panel.tsx`
- Test: `lib/cma/select.test.ts`, `lib/cma/value.test.ts`, `lib/cma/zillow.test.ts` (fixtures in `lib/cma/fixtures/`, captured once from real responses with the Zestimate fields stripped)

**Interfaces:**
- Produces:
  - `zillowByAddress(address: string): Promise<Subject | null>` — `GET https://zillow.realtyapi.io/pro/byaddress?propertyaddress=…`; allowlist `{ zpid, lat, lng, beds, baths, sqft, yearBuilt, lotSqft, taxAssessed, homeType }`.
  - `zillowSold(subject: Subject, window: Window): Promise<RawComp[]>` — `GET /search/bycoordinates` with `latitude`, `longitude`, `radius`, `listingStatus=Sold`, `homeType=Houses`, `sortOrder=Newest`, `soldInLast`, `squareFeetRange=min:<0.8×sqft>, max:<1.25×sqft>`. Builder verifies exact param names against the comp-map skill and RealtyAPI schema (`mcp__claude_ai_realtyapi__get_endpoint_schema`) before writing fixtures.
  - `WINDOWS: Window[]` = `[{soldInLast:'90_days',radius:0.6},{soldInLast:'90_days',radius:1},{soldInLast:'90_days',radius:2},{soldInLast:'6_months',radius:2},{soldInLast:'12_months',radius:2},{soldInLast:'24_months',radius:2}]`; stop at first window yielding ≥5 credible comps.
  - `credibleComps(subject, raw: RawComp[]): Comp[]` — computes true haversine distance; drops sold price < 0.6 × subject tax assessment (non-arm's-length proxy; no Zestimate), year built more than 30 years from subject when ≥5 others remain, lot > 3× subject lot when subject lot < 1 acre; DOM = `lastSoldDate − listingDateTimeOnZillow` in days (null if missing; never `daysOnZillow` for sold); returns sorted per skill priority, max 7.
  - `indicatedValue(subject, comps): { medianPpsf: number; point: number; low: number; high: number }` — range rounded to $5k spanning credible comps' `ppsf × subject.sqft` interquartile span.
  - `GET /api/cma?leadId=` → cached `cmas` row if `created_at` within 7 days for the same `normalized_address`, else computes and stores (`credits_used` counted per request). Dialer prefetches for the *next* queued lead only.
  - CMA panel: range, median $/sqft, comp count, window/radius label ("Closed sales · last 3 months · 0.6 mi"), comp list, lead's own list price/DOM beside it, credits used, "Open seller page draft" → `/cma/[id]`.

- [ ] **Step 1: Write failing tests** — `indicatedValue` on 6 fixture comps gives the hand-computed median $/sqft and range; `credibleComps` drops a $116k sale on a $297k assessment; DOM computed from the two timestamps, null when listing date missing; window search stops at the 1-mile window when the 0.6-mile one returns 3.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Tests PASS; live check on one Richmond address matches the comp-map skill's result for the same address within $5k**
- [ ] **Step 5: Commit** `feat: quick sold-comp CMA on the dialer`

---

### Task 13: CMA editor and public seller page

**Files:**
- Create: `app/(app)/cma/[id]/page.tsx`, `app/(app)/cma/[id]/actions.ts`, `app/c/[slug]/page.tsx`, `app/c/[slug]/map.tsx`, `lib/cma/slug.ts`
- Modify: `netlify.toml` (header `X-Robots-Tag: noindex` for `/c/*`)
- Test: `lib/cma/slug.test.ts`, `e2e/seller-page.spec.ts`

**Interfaces:**
- Consumes: `CmaRow`, `indicatedValue`.
- Produces:
  - `makeSlug(street: string): string` → `<house#>-<street>-<26 random base32 chars from crypto.getRandomValues (128+ bits)>` lowercase hyphenated.
  - Editor: include/exclude comps (recomputes range via `indicatedValue`), editable range and the two notes ("Works in your favor" / "Buyers will weigh") with a "Draft notes" button using `claude-sonnet-5-5` and the comp-map voice rules; Publish sets `published_slug`, `published_at`.
  - Seller page: server-rendered from the published `cmas` row; layout, tokens (light and dark), Leaflet layers (CARTO Voyager with the skill's key, Esri imagery), pins, popups, rings, disclaimer and footer exactly per the comp-map skill §Step 4 (`~/.claude/skills/synced/*/cma-comp-map/SKILL.md`); `<meta name="robots" content="noindex">`; unpublished or unknown slug → 404.

- [ ] **Step 1: Write failing test** — `makeSlug('4417 Grove Ave')` matches `/^4417-grove-ave-[a-z2-7]{26}$/` and two calls differ.
- [ ] **Step 2: Write failing Playwright test** — published fixture CMA renders title `4417 Grove Ave Comps`, has robots noindex meta, shows the footer credential line, contains no `—` character; unpublished slug returns 404.
- [ ] **Step 3: Run, verify FAIL**
- [ ] **Step 4: Implement**
- [ ] **Step 5: Tests PASS; open on a phone-width viewport and check the map stacks under 860px**
- [ ] **Step 6: Commit** `feat: CMA editor and public seller comp page`

---

### Task 14: Settings and playbook management

**Files:**
- Create: `app/(app)/settings/page.tsx`, `app/(app)/settings/actions.ts`, `app/(app)/settings/playbook/page.tsx`, `app/(app)/settings/playbook/actions.ts`, `lib/settings.ts`
- Test: `lib/settings.test.ts`

**Interfaces:**
- Consumes: `jev`, `cardChoice` (test-this-card), `coach_cards` log.
- Produces:
  - `validateHours(hours: SettingsRow['hours']): { ok: true } | { ok: false; error: string }` — rejects any window starting before 08:00 or ending after 21:00, or end ≤ start.
  - Settings page: hours per weekday, retry rules (rounds 1–5, gap 1–48h, ring 20/25/30/45), outcome labels, VM drop recordings (record in browser via `MediaRecorder` → `vm-drops`, up to 3), internal DNC list (add/remove; removal requires typing the number), compliance note text from spec §7.
  - Playbook page: list/add/edit/deactivate cards (title, criteria, say, why); "Test this card" box sends a sample owner line through `jev` with the active cards and shows the top three probabilities; an overlap warning when the new card is runner-up >0.3 on a test line chosen for another card; "Most overridden" table from `coach_cards` (cards with the highest switched+dismissed rate over the last 30 days, min 5 shows).

- [ ] **Step 1: Write failing tests** — `validateHours` rejects `07:30–20:00`, `09:00–21:30`, `10:00–09:00`; accepts `08:00–21:00` and `null` (closed).
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Tests PASS; edit a card's criteria, run `pnpm jev:regress` against the DB playbook (add `--from-db` flag) and see the result**
- [ ] **Step 5: Commit** `feat: settings, voicemail drops, playbook management`

---

### Task 15: Deploy and end-to-end check

**Files:**
- Modify: `README.md` (deploy + Twilio console steps confirmed), `netlify.toml`

- [ ] **Step 1: `pnpm test && pnpm build` clean; `pnpm jev:regress` passes**
- [ ] **Step 2: Create Netlify site, set env vars (scoped Builds + Functions), deploy; set Supabase Auth Site URL and Redirect URL `https://<site>/**`; disable signups**
- [ ] **Step 3: Point the TwiML App Voice URL and the number's inbound webhook at the deployed `APP_URL`**
- [ ] **Step 4: Live checks on production, Daniel calling his own cell:** guardrail blocks a test phone marked vendor DNC (hear "Blocked"); call connects, records, transcribes; a "relisting" line shows the card; saying "take me off your list" shows the DNC banner and pre-selects DNC; voicemail drop plays; callback to the 804 number rings Daniel's cell; publish a CMA and open `/c/<slug>` logged out
- [ ] **Step 5: Commit** `chore: production deploy notes`

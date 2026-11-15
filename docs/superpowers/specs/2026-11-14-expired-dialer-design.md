# Expired Dialer — Design

**Date:** 2026-11-14
**Status:** Reviewed; questions settled 2026-11-14; TypeSafe changes folded in 2026-11-15; pending Daniel's approval
**Working name:** Expired Dialer (repo `~/expired-dialer`)
**Inspiration:** Clairvo (reverse-engineered 2026-11-14 from public sources; see §12)

## 1. Intent

Daniel Yoon is a solo Richmond, VA agent (eXp Realty, SRS). He wants to cold-call
owners of expired listings from a purchased lead list, one call at a time, with
two things no off-the-shelf expired dialer gives him:

1. **Live coaching** on screen while he talks, grounded in that lead's listing
   history (list price, days on market, price cuts).
2. **A quick CMA**: a sold-comp value range on screen during the call, and a
   seller-facing comp-map page he can send afterwards.

This is a personal tool with one user. It is not a product for sale. It
replaces nothing; Foothold (Daniel's earlier distress SaaS) is retired and its
code is free to reuse.

**Success:** Daniel works a morning call block from this app instead of a
vendor dialer, never dials a do-not-call number, sees a useful card within
about one second of an objection, and can tell an owner "here is what actually
sold near you" without leaving the call screen.

## 2. Goals, non-goals, anti-goals

**Goals**
- Import a purchased expired-listing spreadsheet (CSV/XLSX) with a column
  mapping remembered per vendor.
- Single-line, browser-based outbound calling from Daniel's own local 804
  number, through a headset.
- A call queue that tries each lead's phones in order, logs outcomes, and
  schedules callbacks.
- Live coaching cards during the call.
- Post-call recording, transcript, AI summary and suggested outcome.
- Quick CMA on the call screen, plus a publishable seller CMA page.
- Compliance guardrails enforced before every dial (§7).

**Non-goals (v1)**
- Parallel, power or predictive dialing. Single dial only. (Removes pacing,
  abandonment-rate math and answering-machine detection entirely.)
- Texting/SMS (avoids A2P 10DLC registration).
- Inbound call routing beyond Twilio forwarding to Daniel's cell.
- AI voice agents that talk to leads.
- Multi-user, teams, roles, billing.
- CRM sync (Lofty etc.). A webhook-out can come later.
- Public-records enrichment (equity, tenure, distress) — that was Foothold.

**Anti-goals** (failure even if it technically works)
- Dialing a number flagged DNC, or outside permitted hours. One bad dial is a
  real legal exposure; the guardrail must be server-enforced, not UI-only.
- Coaching that distracts: more than one card per owner turn, cards that
  arrive after the moment has passed, or long paragraphs.
- Using a vendor AVM (Zestimate, Redfin Estimate) as the CMA value. The value
  comes from sold comps, shown with its work. (Inherited decision from
  Foothold's comps spec §4; the comp-map skill uses Zestimate only to spot
  non-arm's-length sales, which remains allowed.)
- Any visual borrowing from Anthropic/Claude branding or the Fraunces typeface.

## 3. Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Browser-side audio for coaching.** Twilio Voice JS SDK runs the call in the page; the page streams the local mic and remote audio to Deepgram over WebSockets using a short-lived key; Claude writes cards. | No extra server; ~1s card latency; coaching stops if the tab reloads (the call continues). | **Chosen** |
| B. Server-side media. Twilio Media Streams → always-on WebSocket server (Fly/Railway) → STT → LLM, Clairvo-style. | Survives browser hiccups; path to AI voice agents. Second service to host and pay for (~$5–10/mo); more moving parts. | Rejected for v1 |
| C. Buy, don't build. Vendor dialer (REDX/Vulcan7) + the comp-map skill. | Cheapest start; no coaching tied to the lead's listing data — the core reason for this project. | Rejected |

Hosting location also considered: inside Foothold (rejected — Foothold
retired), standalone web app (**chosen**), local Mac-only app (rejected —
Daniel should be able to call from any computer).

## 4. Stack (builder's calls already made)

- **Next.js 16 + React 19 + Tailwind v4 + TypeScript**, pnpm. Same as Foothold
  so its modules drop in. Next 16 uses `proxy.ts` instead of middleware; read
  Foothold's `AGENTS.md` warning before relying on training-data Next.js.
- **Supabase** (Postgres + Auth + Storage). New project. Single user: magic-link
  login for Daniel's email, signups disabled after first login.
- **Hosting: Netlify** (Foothold's current host; free tier permits commercial
  use, unlike Vercel Hobby).
- **Twilio** Voice: one local 804 number, a TwiML App, the Voice JS SDK
  (`@twilio/voice-sdk`), recordings. No SMS.
- **Deepgram** streaming STT (Nova model), browser connection via temporary
  keys minted server-side.
- **TypeSafe (Jev, `jev-latest`)** for fast typed judgments: live card
  routing, live DNC-request detection, post-call outcome pre-fill, import
  column mapping and DNC value reading (§8, §8a, §5). Server-side only
  (`TYPESAFE_API_KEY`); use the official JS SDK, which retries 429/529.
  Measured ~120ms median per request in experiments (§15).
- **Anthropic Claude**: a fast model (Haiku class, e.g. `claude-haiku-5-5`)
  only as a fallback card writer when Jev returns `none` on a substantive owner
  turn; a stronger model (e.g. `claude-sonnet-5-5`) for post-call summary prose
  and CMA prose. Builder confirms current IDs via the claude-api skill.
- **RealtyAPI** (`zillow` slug) for subject facts and sold/active comps. Key
  `REALTYAPI_KEY` (reuse Foothold's; check remaining credits).
- **Leaflet 1.9.4** + CARTO Voyager / Esri imagery for the seller CMA map.

**Reuse from `~/foothold`** (copy, don't import):
`lib/ai/anthropic.ts` (Claude wrapper with prompt caching), `lib/ai/loop.ts`
if a tool loop is needed, `lib/supabase/*` (server/client/admin/proxy),
`lib/server/api-errors.ts`, `lib/comps/realty.ts` (RealtyAPI comp parsing —
on branch `feat/comps-arv`), the `xlsx` import approach, and the vitest setup.

## 5. Screens

1. **Leads** — table of all leads with status (New, Working, Callback, Appointment,
   Dead, DNC), source batch, expired date, attempts. Import button.
2. **Import** — upload CSV/XLSX → map columns (saved per vendor name) →
   preview → import. Shows counts: created, updated, skipped, DNC phones.
   - **Suggested mapping (first import from a new vendor):** for each column,
     Jev picks a dialer field (Choice over the §10 lead/phone fields plus
     `ignore`) from the header, 3–5 sample values and the full header list.
     Daniel confirms or edits every suggestion before the mapping is saved;
     nothing imports on an unconfirmed mapping.
   - **DNC-column check:** a companion Noul per column ("does this column say
     whether a phone is on a do-not-call/litigator list?"). If it is ≥0.5 on a
     column the mapping left unassigned or `ignore`d, the mapping screen blocks
     saving until Daniel maps it or explicitly dismisses it. (Experiment: the
     field Choice alone missed "Ph2 Status"; the Noul caught it at 0.72 with no
     false positives ≤0.03.)
   - **DNC value reading:** each distinct value in a mapped DNC column is
     classified once by Jev as `do_not_call` / `callable` / `unknown` and shown
     for confirmation; the confirmed table is stored with the vendor mapping.
     `unknown` is treated as unflagged (blocked until the batch is marked
     vendor-scrubbed, §7.1).
   - Phone numbers, dates and prices are parsed by deterministic code, not Jev.
3. **Dialer** (the main screen):

```
┌ Queue: Expireds · Nov 14 ───────────────────── 23 left ┐
│ ▸ 4417 Grove Ave 23221 · Jane Smith     expired 2d ago │
│   Listed $425k · 94 DOM · 2 price cuts · agent: X Realty│
│   (804) 555-0142  mobile   ● In call 01:12   ⏺ rec     │
│   (804) 555-0199  landline ○ next                      │
├──────────────────────────┬─────────────────────────────┤
│ LIVE COACHING            │ QUICK CMA                   │
│ ┌ Objection: relisting ┐ │ Sold nearby: $395k–$415k    │
│ │ Ask what they'd do   │ │ median $212/sqft · 6 comps  │
│ │ differently this time│ │ last 90 days · 0.6 mi       │
│ └──────────────────────┘ │ 1. 4401 Grove  $405k  21 DOM│
│ Transcript (scrolling)…  │ 2. …                        │
│ Script ▾                 │ [Open seller page draft]    │
├──────────────────────────┴─────────────────────────────┤
│ [Connected][No answer][Left VM][Bad #][Wrong person][DNC]│
│ Note ________  Callback [Tue 10:00]  [Drop voicemail]  │
│                                        [Next lead ▸]   │
└────────────────────────────────────────────────────────┘
```

4. **Lead detail** — facts, phones, timeline of calls (recording player,
   transcript, AI summary), callbacks, CMAs.
5. **Callbacks** — Overdue / Today / Upcoming / Done.
6. **CMA editor** — the full comp set with include/exclude toggles, range and
   notes editable, "Publish" → public link.
7. **Settings** — caller ID number, calling hours, retry rules, voicemail drop
   recordings, coaching playbook (default + Daniel's own), outcome list,
   internal DNC list.

Visual direction is left to the builder within the anti-goals. Desk use on a
laptop is primary; it should still work on a tablet. The seller CMA page uses
the comp-map skill's approved look (§9).

## 6. Calling

**Flow.** Browser registers a Twilio `Device` with an access token from
`/api/twilio/token`. Clicking call (or auto-advancing) runs `device.connect({To})`.
Twilio requests the TwiML App's voice URL (`/api/twilio/voice`), which
**re-checks every guardrail server-side** (§7) and returns
`<Dial callerId="+1804…" record="record-from-answer-dual" recordingStatusCallback=…>`
or a rejection. Status and recording callbacks update the `calls` row; all
Twilio webhooks verify `X-Twilio-Signature`.

**Queue order.** Due callbacks first; then leads with no attempts, newest
expired date first; then retries whose cooldown has passed. Filters: source
batch, status.

**Per call.** Try the lead's phones in listed order (mobile before landline
when the vendor marks line type). "No answer" advances to the next phone, or
the next lead when phones are exhausted. "Bad #" marks that phone dead.
"Wrong person" marks that phone wrong for this owner. "DNC" adds the number to
the internal DNC list and marks the lead DNC.

**Retry rules (defaults, editable):** max 3 attempt rounds per lead, at least
24h between rounds, ring timeout 25s. A lead with no outcome after max rounds
becomes Dead.

**Voicemail drop.** Daniel records 1–3 messages in Settings (stored in Supabase
Storage, served to Twilio). "Drop voicemail" calls a route that redirects the
lead's call leg via the Twilio REST API to `<Play>` the chosen file then
`<Hangup>`, disconnects Daniel's leg, and logs "Left VM". He moves on while it
plays.

**Inbound.** Calls to the 804 number forward to Daniel's cell (TwiML
`<Dial>` to `DANIEL_CELL`) and are logged against the matching lead by caller
number when one exists.

**Caller ID setup (one-time, manual by Daniel, documented in README):** Twilio
Trust Hub business/sole-prop profile so calls get STIR/SHAKEN "A" attestation;
CNAM display name registration; optional free registration with the major
carrier spam-label portals. No number rotation — one number, used
consistently, is the reputation strategy for a single caller.

## 7. Compliance guardrails

Enforced in `/api/twilio/voice` (server) and mirrored in the UI:

1. **DNC (hard blocks, server-enforced):**
   - Never dial a phone flagged DNC by the vendor, or present on the internal
     DNC list.
   - A phone that arrives with **no DNC flag** (or a file with no DNC column)
     is not dialable until Daniel marks its batch "scrubbed by vendor" and
     enters the scrub date. *(Daniel's decision.)*
   - Every phone in a batch is blocked once the batch's scrub date is **more
     than 90 days** old, until a fresh file is re-imported. *(Daniel's
     decision; he chose 90 days over the 31-day federal re-scrub interval.)*
   - v1 relies on the vendor's National DNC scrub. (The registry is free for
     up to five area codes if Daniel later wants his own scrub — out of scope.)
2. **Hours:** Daniel calls Virginia owners only, so one time zone: 8:00–21:00
   Eastern is the hard bound. Default window Mon–Sat 9:00–20:00, editable
   within it.
   - *Builder's call:* leads whose property or mailing address is outside
     Virginia are imported but flagged "Out of state" and left out of the
     queue by default, so the Virginia-only assumption that recording and hours
     rely on stays true.
3. **Attempt caps and cooldowns** as in §6.
4. **Identification:** the default script opens with Daniel's name and
   brokerage (Virginia requires callers to identify themselves at the start of
   the call).
5. **Recording consent:** Virginia is a one-party-consent state and Daniel is
   on every call, so all calls to Virginia owners are recorded
   (`record-from-answer-dual`) and both sides are transcribed. Out-of-state
   leads are excluded from the queue (item 2), so no all-party-consent logic is
   needed in v1.

The app shows "Calling rules support your process; you remain responsible for
compliance" in Settings. Not legal advice.

## 8. Live coaching

**Audio path.** From the Twilio `Call` object in the browser, take the local
(mic) and remote (owner) `MediaStream`s. Open two Deepgram live WebSockets,
one per stream, so the speaker is known without diarization. Keys come from
`/api/deepgram/token` (short TTL, scoped to streaming).

**Card routing (Jev selects, it does not generate).** When Deepgram reports
end of utterance on the **owner** stream, POST to `/api/coach`. The route makes
**one** TypeSafe request whose state is `{ call_context, transcript_so_far
(last ~90s, labeled, ending with the rep's last line), owner_said }` and whose
questions run in parallel:
- `card` — Choice over the playbook cards' `criteria` (one per card, plus
  `none`): "Which response card should the agent's screen show for what the
  homeowner just said in `owner_said`, as an answer to the rep's last line?"
- `dnc` — the DNC-request Noul (§8a).

The chosen card's pre-written text is rendered by code, interpolating lead
variables (`%lead.first_name%`, list price, DOM, quick-CMA range, etc.). No
LLM text sits on the critical path.

Display rules:
- **Confident** (card confidence ≥0.6, an initial threshold to tune on real
  calls): show that one card.
- **Unsure** (<0.6): show the top two cards as two compact options. In
  experiments, every miss had the correct card as the runner-up.
- **`none`**: show nothing, unless the owner turn is substantive (≥6 words);
  then fall back to Claude (fast model) to write one card
  `{ title, say ≤20 words, why }`, labeled "AI-written". The Claude system prompt
  is byte-stable for prompt caching; lead data goes in the user message.
- At most one card per owner turn; drop a response if a newer owner turn has
  arrived.
- Latency target: card visible ≤1s after Deepgram's end-of-utterance event
  (Jev measured ~120ms median, 191ms max, at the full context size).

**Playbook (structured, not one markdown blob).** Each card is a row:
`key`, on-screen `title`, `criteria` (the definition Jev classifies against),
`say` (Daniel's words, may use lead variables), optional `why`, `active`.
Ships with a default expired-listing set (tested): relisting with their agent,
taking it off the market, selling it themselves, commission objection, why it
didn't sell, price expectation, not ready yet, call me later, how did you get
my number, too many agents calling, already sold or rented, buying signal, flat
not-interested, and `none`.

**Criteria writing rule (from experiments):** define each card by **what the
owner's line is about**, not only by its surface words, and keep overlapping
cards separated by a stated distinction. The tested pair:
- *Call me later* — about the timing of **this conversation**: busy, driving,
  spouse not home; later today or within about a week.
- *Not ready yet* — about the timing of **selling**: a season, life event or
  market change months away, or vaguely noncommittal about selling again.

Settings warns when a newly added card's criteria overlap an existing one and
offers a "test this card" box that runs a sample line through Jev.

**Learning from use.** Every routed card stores the Jev choice, confidence,
the runner-up, and whether Daniel used, dismissed or switched it (`coach_cards`,
§10). A Settings view lists the most-overridden cards so criteria can be
rewritten.

### 8a. Live DNC-request detector

On every owner turn, the `dnc` Noul asks whether the owner asked to stop being
called, be removed from a list, or never be called again; a request to call at
a later time is explicitly not a stop request. If `dnc` ≥0.5 (experiments:
true requests 0.96–0.98, everything else ≤0.12, including "don't call me again
until next week"):
- a banner appears: "Owner asked not to be called — mark Do Not Call?" with
  one-click confirm;
- the call's outcome is preselected as **DNC**, and saving any other outcome
  requires an explicit override click.
Nothing is added to `dnc_numbers` without Daniel's confirmation. A post-call
pass (§8b) re-checks the full transcript for the same request.

**Transcript persistence.** The browser posts final transcript segments to the
call record as they arrive, so a mid-call reload loses only coaching, not the
transcript so far.

### 8b. Post-call pre-fill

The moment the call ends, one TypeSafe request over the full transcript asks,
in parallel:
- `outcome` — Choice over the campaign outcome list ("use the final position
  the owner took");
- `appointment` — Noul: a specific day and time to meet was agreed;
- `callback_time` — Noul: the owner gave a specific day or time for a
  follow-up call (not just "later");
- `dnc` — the §8a Noul, using the owner's final word.

The outcome buttons appear pre-selected and the callback picker opens when
`callback_time` ≥0.5; Daniel confirms with one click or changes it.
(Experiments: 10/10 on outcome and all three Nouls, ~130ms.) Claude (stronger
model) then writes the prose summary, call note and next step in the
background; it no longer chooses the outcome.

## 9. CMA

**Quick CMA (call screen).** When a lead becomes the next in queue, a server
route runs the comp-map skill's algorithm via RealtyAPI:
- `GET /pro/byaddress` → subject (zpid, lat/lng, beds, baths, sqft, year,
  lot). Allowlist fields; never store or use the Zestimate as a value.
- `GET /search/bycoordinates` sold, houses, sqft −20%/+25%, widening rings:
  90 days at 0.6 mi → 1 → 2 mi → 6 months → 12 → 24 months; stop at ≥5 comps.
- Exclusions per the skill (non-arm's-length, much older, acreage mismatch).
- Median $/sqft × subject sqft → indicated value; range rounded to $5k over
  credible comps; days on market computed from listing date to sold date (not
  `daysOnZillow`).
- Cache per normalized address for 7 days. Pre-fetch only the next lead in
  queue, not the whole list, to conserve credits; show the credit cost per
  CMA in the UI.

Shown: range, median $/sqft, comp count and window/radius used, the comp list,
and the subject's own listing history from the imported file next to it
("listed $425k → sold comps say $395k–$415k").

**Seller CMA page.** From the CMA editor, Daniel adjusts the comp set, range
and the two notes ("Works in your favor" / "Buyers will weigh"), then
publishes. The app serves it at `/c/<slug>` (public, `noindex`, unguessable
slug), rendered from the stored CMA with the comp-map skill's design: Manrope,
slate-navy/sage tokens with dark mode, Leaflet map with subject pin, numbered
sold pins, square active pins, price tooltips, synced detail panel, actives
toggle, footer credential line
`eXp Realty · Seller Representative Specialist (SRS) · danielyoonrealty.com`,
and the skill's disclaimer text. Voice: no em-dashes, no exclamation marks,
numbers first. Existing propcomp.org pages are untouched.

## 10. Data model (sketch)

- `import_mappings` (vendor name → column map)
- `import_batches` (file, vendor, counts, created_at)
- `leads` (address, normalized_address, city, zip, owner names, mailing
  address, list price, original price, DOM, price cuts, expired date, listing
  brokerage, status, attempts, next_eligible_at, raw jsonb, batch_id)
- `phones` (lead_id, number E.164, position, line_type, vendor_dnc, status:
  ok/dead/wrong)
- `dnc_numbers` (number, reason, added_at)
- `calls` (lead_id, phone_id, twilio sids, started/answered/ended, outcome,
  note, recording path, ai summary jsonb)
- `transcript_segments` (call_id, speaker rep/owner, text, t_start, t_end)
- `playbook_cards` (key, title, criteria, say, why, active, sort)
- `coach_cards` (call_id, segment ref, source jev/claude, card key, confidence,
  runner_up key + probability, dnc_p, latency_ms, action used/dismissed/switched)
- `callbacks` (lead_id, due_at, done_at, note)
- `cmas` (lead_id, address, subject jsonb, comps jsonb, range, window, radius,
  notes, published_slug, published_at, credits_used)
- `settings` (single row: caller id, hours, retry rules, outcome list,
  voicemail drops)
- `import_mappings` additionally stores the confirmed DNC value table per vendor

Dedupe on import by normalized address; re-importing an existing lead updates
listing fields and adds new phones without touching call history.

## 11. Decisions settled after review

1. **Recording:** Virginia owners only → one-party consent, record everything
   (§7.5).
2. **DNC gaps:** unflagged numbers blocked until the batch is marked
   vendor-scrubbed; batches blocked after a 90-day-old scrub date (§7.1).
3. **Caller ID:** a **new local 804 number bought on Twilio** (not Daniel's
   existing cell, not a port). Inbound calls to it forward to `DANIEL_CELL`.
   Trust Hub + STIR/SHAKEN "A" attestation + CNAM as in §6.
4. **Lead vendor:** not chosen yet. *Builder's call:* the import is a generic
   mapper. Each vendor mapping names the columns for owner, address, phones
   (1–n), line type, DNC flag and its true/false spellings, and scrub date.
   A real sample export is needed before the import is called done.
5. **Seller CMA domain:** *builder's call:* served from the app's own Netlify
   address for v1; a custom subdomain (e.g. `cma.danielyoonrealty.com`) can be
   added later with no code change beyond config.

## 12. Reference: what Clairvo does that this deliberately skips

Clairvo (clairvo.io) is a multi-seat parallel dialer: Twilio + self-hosted
LiveKit SIP media, 2–3 line parallel dialing with Bayesian-tuned predictive
pacing, AMD, local-presence number pools with daily caps and rotation,
AssemblyAI + OpenRouter coaching, ClickHouse reporting, Stripe prepaid
billing, workflow builder. This design keeps the coaching, outcome-driven
follow-up and compliance checks, and drops everything that exists to serve
parallel dialing or multiple reps.

## 13. Costs (estimates)

| Item | Cost |
|---|---|
| Twilio local number | ~$1.15/mo + carrier/CNAM fees |
| Twilio outbound voice | ~$0.014/min; recording ~$0.0025/min + storage |
| Deepgram streaming | ~$0.0077/min per stream × 2 streams |
| TypeSafe | per input token; ~1 request per owner turn + 1 per call + import-time mapping |
| Claude | cents per call block (fallback cards only, Sonnet summaries) |
| RealtyAPI | ~2–6 credits per CMA from existing balance |
| Supabase | free tier, or ~$10/mo extra compute if added to the Pro org |
| Netlify | free tier |
| Expired lead list | vendor price (Daniel's purchase) |

## 14. Left to the builder

Visual design within anti-goals; exact table/column names; keyboard shortcuts;
queue UI details; Deepgram model and endpointing settings; CMA cache
invalidation; final confidence/Noul thresholds after real calls; test strategy
(vitest for guardrails, import mapping, CMA math, and a Jev regression set
seeded from `experiments/typesafe/` that runs on playbook edits; Playwright for
the dialer flow with a mocked Twilio Device and mocked TypeSafe).

## 15. TypeSafe experiment evidence (2026-11-15)

Scripts and raw results: `experiments/typesafe/` (`run.py`, `followup.py`,
`results/`). Model `jev-latest`. All data synthetic, written to resemble
expired-listing calls and vendor exports; small n. Card criteria were revised
after seeing misses, so the 36/36 figure is partly fitted to these examples.
Validate on real calls via the `coach_cards` log.

| Experiment | Result | Median latency |
|---|---|---|
| Card routing, 24 clean utterances | 24/24 | 118ms |
| Card routing, 12 ASR-style, context-dependent | 10/12 → 36/36 on both sets after the criteria rule in §8 | 126ms |
| DNC-request Noul, 36 turns | 36/36 at 0.5; true ≥0.96, false ≤0.12 | — |
| Post-call outcome + 3 Nouls, 10 calls | 10/10 each | 130ms |
| Column mapping, 21 columns | 20/21; DNC-column Noul caught the miss | 112ms |
| DNC value reading, 11 values | 11/11 | — |

Claude card-writing latency was not measured in this session; the latency gain
is expected, not measured.

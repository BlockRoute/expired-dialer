# Expired Dialer

Single-user expired-listing cold-calling app (Next.js 16, Supabase, Twilio Voice, Netlify).

## Setup

1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill it in (every variable in the table below;
   `.env.example` should list exactly the same names).
3. Create a Supabase project and apply **all** migrations, `0001` through `0008`, in order:
   `pnpm exec supabase link --project-ref <ref>` then `pnpm exec supabase db push`
   (locally: `supabase start` + `supabase db reset`). Applying only `0001_init.sql` leaves
   out the outcome, round, CMA and DNC-review functions and dialing will fail.
4. **Authorize yourself (required, one time).** Every table is locked to the owner by
   RLS. Insert your email into the owner table (SQL editor, as the `postgres` role):

   ```sql
   insert into private.app_owner (email) values ('you@example.com');
   ```

   Use the same address for `ALLOWED_EMAIL`. In Supabase Auth settings add
   `${APP_URL}/auth/callback` to the redirect URLs.
   Also **disable new signups** (Supabase Dashboard > Authentication > Providers > Email /
   Sign In / Providers > turn off "Allow new users to sign up"). The login form already
   passes `shouldCreateUser: false`, but the server setting is the real guard.
5. `pnpm dev`, open `/login`, request a sign-in link.

Commands: `pnpm test` (Vitest), `pnpm build`, `pnpm lint`.

## Environment variables

Every variable the code reads. `.env.example` should mirror this list.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon/publishable key. Never a service-role key. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is accepted as an alias |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only secret key; used by Twilio webhooks, the coach/finish routes, `pnpm jev:regress` and the e2e seeds |
| `ALLOWED_EMAIL` | The single email allowed to sign in (case-insensitive) |
| `APP_URL` | Public base URL, used for Twilio webhook URLs and signature checks |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account credentials (webhook signature checks, REST) |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | API key used to mint Voice access tokens |
| `TWILIO_TWIML_APP_SID` | TwiML App SID used by the browser Device |
| `TWILIO_CALLER_ID` | The purchased 804 number in E.164 (Settings > caller ID overrides it) |
| `DANIEL_CELL` | Cell number (E.164) inbound calls forward to |
| `DEEPGRAM_API_KEY` | Live call transcription |
| `TYPESAFE_API_KEY` | TypeSafe (Jev) coaching, outcome pre-fill and the DNC checks |
| `ANTHROPIC_API_KEY` | Coach fallback cards, call summaries, CMA note drafts |
| `REALTYAPI_KEY` | RealtyAPI.io (Zillow) subject, sold comps and actives for CMAs |
| `E2E_STORAGE_STATE` | Playwright only: storage state file of a signed-in owner session |

## One-time manual steps (Twilio, spec section 6)

1. Buy a local 804 number in Twilio.
2. Create an API key (Account > API keys) and put the SID and secret in the env vars above.
3. Create a TwiML App and set its Voice request URL to `${APP_URL}/api/twilio/voice`
   (HTTP POST). Put its SID in `TWILIO_TWIML_APP_SID`.
4. On the purchased number, set the Voice webhook (A call comes in) to
   `${APP_URL}/api/twilio/inbound`.
5. Trust Hub: create a business or sole-proprietor profile and assign the number so
   calls get SHAKEN/STIR "A" attestation.
6. Register the CNAM display name for the number.
7. Optional: register the number with the major carrier spam-label portals.

Use one number consistently; there is no number rotation.

## Hosting

Netlify (`netlify.toml`): build `pnpm build`, Node 24, pnpm 10.27.0. Set the env vars
above in the Netlify site settings.

Function time limit (assumption): the server code is sized for Netlify's 26 s synchronous
function limit. The Quick CMA stops its RealtyAPI search after 20 s (6 s per request) and
answers `error`, recording the credits spent; the post-call route's Jev check (8 s) plus
one Claude summary attempt (15 s, no retry) run inside the same invocation; the CMA note
draft is one 20 s attempt. If the site's limit is lower (10 s on some plans), lower
`SEARCH_BUDGET_MS` in `app/api/cma/route.ts` and `SUMMARY_TIMEOUT_MS` in
`app/api/calls/[id]/finish/route.ts` to match.

## DNC review

After every call with owner speech, the whole transcript is re-checked for a request not
to be called. When it reads one (>= 0.5) and the saved outcome is not DNC, the call is
marked `dnc_suspected` and the lead gets `dnc_review_at`: the dialer and the voice route
refuse to dial it until you choose **Confirm DNC** (lead DNC, every number on it added to
the internal DNC list) or **Not a DNC request** on the lead page. Nothing is added to the
DNC list without that click.

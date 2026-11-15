# Expired Dialer

Single-user expired-listing cold-calling app (Next.js 16, Supabase, Twilio Voice, Netlify).

## Setup

1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. Create a Supabase project and apply `supabase/migrations/0001_init.sql`
   (`pnpm exec supabase db push`, or `supabase start` + `supabase db reset` locally).
4. **Authorize yourself (required, one time).** Every table is locked to the owner by
   RLS. Insert your email into the owner table (SQL editor, as the `postgres` role):

   ```sql
   insert into private.app_owner (email) values ('you@example.com');
   ```

   Use the same address for `ALLOWED_EMAIL`. In Supabase Auth settings add
   `${APP_URL}/auth/callback` to the redirect URLs.
5. `pnpm dev`, open `/login`, request a sign-in link.

Commands: `pnpm test` (Vitest), `pnpm build`, `pnpm lint`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon/publishable key. Never a service-role key. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is accepted as an alias |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only secret key; used by Twilio webhooks and background work |
| `ALLOWED_EMAIL` | The single email allowed to sign in (case-insensitive) |
| `APP_URL` | Public base URL, used for Twilio webhook URLs |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account credentials (webhook signature checks, REST) |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | API key used to mint Voice access tokens |
| `TWILIO_TWIML_APP_SID` | TwiML App SID used by the browser Device |
| `TWILIO_CALLER_ID` | The purchased 804 number in E.164 |
| `ANTHROPIC_API_KEY` | Coaching and call summaries |
| `DANIEL_CELL` | Cell number (E.164) inbound calls forward to (later task) |
| `DEEPGRAM_API_KEY` | Live call transcription (later task) |
| `TYPESAFE_API_KEY` | TypeSafe (Jev) coaching classifier (later task) |
| `REALTYAPI_KEY` | RealtyAPI.io sold comps for CMAs (later task) |

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

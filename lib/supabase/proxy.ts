import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { isAllowedEmail } from '@/lib/auth';
import { publicSupabaseConfig } from './config';

// Public: login flow, shared call pages (/c/*), and Twilio webhooks, which
// authenticate by signature instead of session. /api/twilio/token is NOT public.
const PUBLIC_EXACT = [
  '/login',
  '/auth/callback',
  '/api/twilio/voice',
  '/api/twilio/status',
  '/api/twilio/recording',
  '/api/twilio/inbound',
];
const PUBLIC_PREFIXES = ['/c/'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url: supabaseUrl, key } = publicSupabaseConfig();

  const supabase = createServerClient(
    supabaseUrl,
    key,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
          for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_EXACT.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  if (isPublic) return response;

  const allowed = !!user && isAllowedEmail(user.email);
  if (allowed) return response;

  const isApi = path.startsWith('/api/');
  const notAllowed = !!user;
  if (notAllowed) await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (notAllowed) url.searchParams.set('error', 'not-allowed');
  else url.searchParams.set('next', path + request.nextUrl.search);
  const denied = isApi
    ? NextResponse.json({ error: notAllowed ? 'not-allowed' : 'unauthenticated' }, { status: 401 })
    : NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) denied.cookies.set(cookie);
  for (const name of ['cache-control', 'expires', 'pragma']) {
    const value = response.headers.get(name);
    if (value) denied.headers.set(name, value);
  }
  return denied;
}

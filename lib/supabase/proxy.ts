import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { publicSupabaseConfig } from './config';

// Twilio webhooks (/api/twilio) authenticate by signature, not session.
const PUBLIC_PATHS = ['/login', '/auth/callback', '/api/twilio'];

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
  const isPublic =
    PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (!user && !isPublic) {
    const denied = path.startsWith('/api/')
      ? NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
      : null;
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', path + request.nextUrl.search);
    const redirect = denied ?? NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    for (const name of ['cache-control', 'expires', 'pragma']) {
      const value = response.headers.get(name);
      if (value) redirect.headers.set(name, value);
    }
    return redirect;
  }

  return response;
}

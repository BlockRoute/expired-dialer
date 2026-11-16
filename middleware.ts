// Next.js 16 renamed middleware.ts to proxy.ts, but proxy.ts only runs on the
// Node runtime, which OpenNext for Cloudflare supports only experimentally.
// middleware.ts still runs on the edge runtime, OpenNext's supported path.
import { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

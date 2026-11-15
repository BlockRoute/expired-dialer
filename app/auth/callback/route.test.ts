import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ data: { user: { email: 'intruder@evil.com' } }, error: null }),
      signOut,
    },
  }),
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

describe('auth callback', () => {
  const original = process.env.ALLOWED_EMAIL;
  beforeEach(() => {
    process.env.ALLOWED_EMAIL = 'dyoonrealty@gmail.com';
    signOut.mockClear();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOWED_EMAIL;
    else process.env.ALLOWED_EMAIL = original;
  });

  it('signs out and redirects a non-allowed user to /login?error=not-allowed', async () => {
    const res = await GET(new NextRequest('https://app.test/auth/callback?code=abc'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/login?error=not-allowed');
  });
});

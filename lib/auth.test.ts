import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAllowedEmail } from './auth';

describe('isAllowedEmail', () => {
  const original = process.env.ALLOWED_EMAIL;
  beforeEach(() => {
    process.env.ALLOWED_EMAIL = 'dyoonrealty@gmail.com';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOWED_EMAIL;
    else process.env.ALLOWED_EMAIL = original;
  });

  it('accepts the configured email', () => {
    expect(isAllowedEmail('dyoonrealty@gmail.com')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isAllowedEmail('DYoonRealty@Gmail.com')).toBe(true);
  });
  it('rejects other emails', () => {
    expect(isAllowedEmail('x@y.com')).toBe(false);
  });
  it('rejects missing emails', () => {
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
  });
  it('rejects everything when ALLOWED_EMAIL is unset', () => {
    delete process.env.ALLOWED_EMAIL;
    expect(isAllowedEmail('dyoonrealty@gmail.com')).toBe(false);
  });
});

describe('requireUserApi', () => {
  const original = process.env.ALLOWED_EMAIL;
  beforeEach(() => {
    process.env.ALLOWED_EMAIL = 'dyoonrealty@gmail.com';
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('@/lib/supabase/server');
    if (original === undefined) delete process.env.ALLOWED_EMAIL;
    else process.env.ALLOWED_EMAIL = original;
  });

  async function load(result: { data: { user: { email?: string } | null }; error: unknown }) {
    vi.doMock('@/lib/supabase/server', () => ({
      createSupabaseServerClient: async () => ({ auth: { getUser: async () => result } }),
    }));
    return (await import('./auth')).requireUserApi;
  }

  it('returns the allowed user', async () => {
    const fn = await load({ data: { user: { email: 'dyoonrealty@gmail.com' } }, error: null });
    await expect(fn()).resolves.toMatchObject({ email: 'dyoonrealty@gmail.com' });
  });
  it('throws UNAUTHENTICATED with no user', async () => {
    const fn = await load({ data: { user: null }, error: null });
    await expect(fn()).rejects.toThrow('UNAUTHENTICATED');
  });
  it('throws UNAUTHENTICATED for a non-allowed email', async () => {
    const fn = await load({ data: { user: { email: 'x@y.com' } }, error: null });
    await expect(fn()).rejects.toThrow('UNAUTHENTICATED');
  });
  it('throws UNAUTHENTICATED on auth error', async () => {
    const fn = await load({ data: { user: { email: 'dyoonrealty@gmail.com' } }, error: new Error('x') });
    await expect(fn()).rejects.toThrow('UNAUTHENTICATED');
  });
});

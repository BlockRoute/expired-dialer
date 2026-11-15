import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

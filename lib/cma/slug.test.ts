import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeSlug } from './slug';

describe('makeSlug', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is house number + street + 26 base32 chars, lowercase and hyphenated', () => {
    expect(makeSlug('4417 Grove Ave')).toMatch(/^4417-grove-ave-[a-z2-7]{26}$/);
    expect(makeSlug('  12B  St. John\'s Rd ')).toMatch(/^12b-st-john-s-rd-[a-z2-7]{26}$/);
  });

  it('differs between calls', () => {
    expect(makeSlug('4417 Grove Ave')).not.toBe(makeSlug('4417 Grove Ave'));
  });

  it('draws its randomness from crypto.getRandomValues', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    makeSlug('4417 Grove Ave');
    expect(spy).toHaveBeenCalled();
  });
});

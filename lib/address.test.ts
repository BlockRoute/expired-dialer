import { describe, it, expect } from 'vitest';
import { normalizeAddress } from './address';

describe('normalizeAddress', () => {
  it('matches across suffix, punctuation and zip+4', () => {
    expect(normalizeAddress('4417 Grove Avenue', '23221-1234')).toBe(
      normalizeAddress('4417 GROVE AVE.', '23221'),
    );
  });
  it('abbreviates directions and suffixes', () => {
    expect(normalizeAddress('12  North  Oak Street', '23221')).toBe('12 N OAK ST 23221');
  });
  it('omits zip when null', () => {
    expect(normalizeAddress('1 Main Road', null)).toBe('1 MAIN RD');
  });
});

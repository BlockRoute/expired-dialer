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
  it('one canonical unit form for APT, #, UNIT, STE', () => {
    const want = '10 OAK ST UNIT 4 23221';
    for (const street of ['10 Oak St Apt 4', '10 Oak St #4', '10 Oak St # 4', '10 Oak St Unit 4', '10 Oak St Ste 4', '10 Oak St Suite 4', '10 Oak St Apartment 4', '10 Oak St, Apt. #4'])
      expect(normalizeAddress(street, '23221')).toBe(want);
  });
  it('abbreviates circle, place, parkway, terrace, way', () => {
    expect(normalizeAddress('1 Oak Circle', null)).toBe('1 OAK CIR');
    expect(normalizeAddress('1 Oak Place', null)).toBe('1 OAK PL');
    expect(normalizeAddress('1 Oak Parkway', null)).toBe(normalizeAddress('1 Oak Pkwy', null));
    expect(normalizeAddress('1 Oak Pky', null)).toBe('1 OAK PKWY');
    expect(normalizeAddress('1 Oak Terrace', null)).toBe('1 OAK TER');
    expect(normalizeAddress('1 Oak Terr', null)).toBe('1 OAK TER');
    expect(normalizeAddress('1 Oak Wy', null)).toBe('1 OAK WAY');
  });
  it('abbreviates the compound directionals', () => {
    expect(normalizeAddress('5 Northeast Main Street', null)).toBe('5 NE MAIN ST');
    expect(normalizeAddress('5 Main St Southwest', null)).toBe('5 MAIN ST SW');
    expect(normalizeAddress('5 Northwest Oak Rd', null)).toBe('5 NW OAK RD');
    expect(normalizeAddress('5 Southeast Oak Rd', null)).toBe('5 SE OAK RD');
  });
});

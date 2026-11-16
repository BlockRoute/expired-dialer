import { describe, expect, it } from 'vitest';
import { buildLeads } from './build';
import { importedLeadsSchema, scrubDateError } from './schema';

const good = () =>
  buildLeads(
    [{ A: '4417 Grove Ave', Z: '23221', P: '8045550142', P$: 'x', L: '425000' }],
    {
      vendor: 'v',
      columns: {
        A: { field: 'property_address' },
        Z: { field: 'property_zip' },
        P: { field: 'phone', slot: 1 },
        L: { field: 'list_price' },
      },
      dncValues: {},
    },
  ).leads;

describe('importedLeadsSchema', () => {
  it('accepts what buildLeads produces', () => {
    expect(importedLeadsSchema.safeParse(good()).success).toBe(true);
  });

  it('rejects non-allowlisted fields, bad numbers, bad enums, empty address', () => {
    const bad = (mut: (l: ReturnType<typeof good>[number]) => void) => {
      const l = structuredClone(good());
      mut(l[0]);
      return importedLeadsSchema.safeParse(l).success;
    };
    expect(bad((l) => Object.assign(l.fields, { id: 'x' }))).toBe(false);
    expect(bad((l) => Object.assign(l.fields, { attempt_rounds: 0 }))).toBe(false);
    expect(bad((l) => Object.assign(l.fields, { status: 'dnc' }))).toBe(false);
    expect(bad((l) => (l.phones[0].number = '8045550142'))).toBe(false);
    expect(bad((l) => (l.phones[0].vendorDnc = 'maybe' as never))).toBe(false);
    expect(bad((l) => (l.phones[0].lineType = 'fax' as never))).toBe(false);
    expect(bad((l) => (l.normalizedAddress = ''))).toBe(false);
    expect(bad((l) => (l.outOfState = 'no' as never))).toBe(false);
  });
});

describe('scrubDateError', () => {
  // 23:30 ET on Nov 15 is already Nov 16 in UTC: "today" is the Eastern date.
  const now = new Date('2026-11-16T04:30:00Z');
  it('accepts today and past dates (Eastern)', () => {
    expect(scrubDateError('2026-11-15', now)).toBeNull();
    expect(scrubDateError('2026-08-01', now)).toBeNull();
  });
  it('rejects a date after today in America/New_York', () => {
    expect(scrubDateError('2026-11-16', now)).toMatch(/future/);
    expect(scrubDateError('2027-11-01', now)).toMatch(/future/);
  });
  it('rejects a missing or malformed date', () => {
    expect(scrubDateError('', now)).toMatch(/required/);
    expect(scrubDateError('11/01/2026', now)).toMatch(/required/);
    expect(scrubDateError('2026-02-30', now)).toMatch(/required/);
  });
});

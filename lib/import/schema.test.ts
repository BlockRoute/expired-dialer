import { describe, expect, it } from 'vitest';
import { buildLeads } from './build';
import { importedLeadsSchema } from './schema';

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

import { describe, expect, it } from 'vitest';
import { buildLeads, mergeLead, mergeVendorDnc, mostCommonScrubDate } from './build';
import type { VendorMapping } from './mapping';
import type { ImportedLead } from './build';
import type { LeadRow } from '../db/types';

const mapping: VendorMapping = {
  vendor: 'test',
  columns: {
    Address: { field: 'property_address' },
    Zip: { field: 'property_zip' },
    State: { field: 'property_state' },
    'Mail State': { field: 'mailing_state' },
    'Phone 1': { field: 'phone', slot: 1 },
    'Phone 1 Type': { field: 'phone_type', slot: 1 },
    'Phone 1 DNC': { field: 'phone_dnc', slot: 1 },
    'Phone 2': { field: 'phone', slot: 2 },
    'Phone 2 Type': { field: 'phone_type', slot: 2 },
    LP: { field: 'list_price' },
    Exp: { field: 'expired_date' },
    Scrubbed: { field: 'scrub_date' },
  },
  dncValues: { Y: 'do_not_call', N: 'callable' },
};

const base = { Address: '4417 Grove Ave', Zip: '23221', State: 'VA' };

describe('buildLeads', () => {
  it('orders phones mobile first, then by slot', () => {
    const { leads } = buildLeads(
      [{ ...base, 'Phone 1': '(804) 555-0142', 'Phone 1 Type': 'L', 'Phone 2': '8045550199', 'Phone 2 Type': 'W' }],
      mapping,
    );
    expect(leads[0].phones.map((p) => p.number)).toEqual(['+18045550199', '+18045550142']);
    expect(leads[0].phones.map((p) => p.lineType)).toEqual(['mobile', 'landline']);
    expect(leads[0].phones.map((p) => p.position)).toEqual([1, 2]);
  });

  it('maps DNC values; blank or unlisted is unknown', () => {
    const row = (v: string) => ({ ...base, 'Phone 1': '8045550142', 'Phone 1 DNC': v });
    const dnc = (v: string, i: number) =>
      buildLeads([{ ...row(v), Address: `${i} Main St` }], mapping).leads[0].phones[0].vendorDnc;
    expect([dnc('Y', 1), dnc('N', 2), dnc('', 3), dnc('Maybe', 4)]).toEqual([
      'do_not_call', 'callable', 'unknown', 'unknown',
    ]);
  });

  it('flags mailing state outside VA as outOfState', () => {
    const { leads } = buildLeads([{ ...base, 'Mail State': 'MD', 'Phone 1': '8045550142' }], mapping);
    expect(leads[0].outOfState).toBe(true);
    const va = buildLeads([{ ...base, 'Mail State': 'Virginia', 'Phone 1': '8045550142' }], mapping);
    expect(va.leads[0].outOfState).toBe(false);
  });

  it('skips rows with no valid phone or no address', () => {
    const { leads, skipped } = buildLeads(
      [{ ...base, 'Phone 1': '555-0142' }, { Address: '', 'Phone 1': '8045550142' }],
      mapping,
    );
    expect(leads).toHaveLength(0);
    expect(skipped).toEqual([
      { row: 1, reason: 'no_valid_phone' },
      { row: 2, reason: 'no_address' },
    ]);
  });

  it('parses prices and dates, and merges duplicate addresses', () => {
    const { leads } = buildLeads(
      [
        { ...base, LP: '$425,000', Exp: '11/12/2026', 'Phone 1': '8045550142' },
        { ...base, 'Phone 1': '8045550199' },
      ],
      mapping,
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].fields.list_price).toBe(425000);
    expect(leads[0].fields.expired_date).toBe('2026-11-12');
    expect(leads[0].normalizedAddress).toBe('4417 GROVE AVE 23221');
    expect(leads[0].phones).toHaveLength(2);
  });
});

describe('mostCommonScrubDate', () => {
  it('returns the most common mapped scrub date as ISO', () => {
    const rows = [{ Scrubbed: '11/01/2026' }, { Scrubbed: '2026-11-01' }, { Scrubbed: '10/30/2026' }];
    expect(mostCommonScrubDate(rows, mapping)).toBe('2026-11-01');
    expect(mostCommonScrubDate([{ Scrubbed: '' }], mapping)).toBeNull();
  });
});

describe('mergeLead', () => {
  const existing = {
    id: 'x', status: 'working', list_price: 400000, owner_full_name: 'A B', normalized_address: 'K',
  } as LeadRow;
  const incoming = (over: Partial<LeadRow> = {}): ImportedLead => ({
    normalizedAddress: 'K',
    fields: { list_price: 380000, owner_full_name: null, ...over },
    phones: [],
    outOfState: false,
  });

  it.each(['dnc', 'dead', 'appointment'] as const)('keeps %s status', (status) => {
    const patch = mergeLead({ ...existing, status }, incoming());
    expect(patch.status ?? status).toBe(status);
    expect('status' in patch).toBe(false);
  });

  it('updates listing fields but not blanks, ids, or keys', () => {
    const patch = mergeLead(existing, incoming({ id: 'zzz', normalized_address: 'Z' } as Partial<LeadRow>));
    expect(patch.list_price).toBe(380000);
    expect('owner_full_name' in patch).toBe(false);
    expect('id' in patch).toBe(false);
    expect('normalized_address' in patch).toBe(false);
  });
});

describe('mergeVendorDnc', () => {
  it('never downgrades do_not_call, otherwise takes incoming', () => {
    expect(mergeVendorDnc('do_not_call', 'callable')).toBe('do_not_call');
    expect(mergeVendorDnc('callable', 'do_not_call')).toBe('do_not_call');
    expect(mergeVendorDnc('unknown', 'callable')).toBe('callable');
    expect(mergeVendorDnc('callable', 'unknown')).toBe('unknown');
  });
});

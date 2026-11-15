import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLeads } from './build';
import type { VendorMapping } from './mapping';
import { parseSheet } from './parse';

function fixture() {
  const buf = readFileSync(new URL('../../fixtures/sample-vendor.csv', import.meta.url));
  return parseSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'sample-vendor.csv');
}

describe('parseSheet', () => {
  it('keeps a __proto__ header as a plain key without touching prototypes', () => {
    const csv = Buffer.from('__proto__,Address\npolluted,1 Main St\n');
    const { headers, rows } = parseSheet(csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength) as ArrayBuffer, 'x.csv');
    expect(headers).toEqual(['__proto__', 'Address']);
    expect(Object.keys(rows[0])).toEqual(['__proto__', 'Address']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(rows[0])).toBeNull();
  });

  it('reads headers and trimmed string rows from the sample vendor CSV', () => {
    const { headers, rows } = fixture();
    expect(headers).toHaveLength(21);
    expect(headers.slice(0, 3)).toEqual(['Owner Name', 'Situs Address', 'Mail Addr']);
    expect(rows).toHaveLength(3);
    expect(rows[0]['Phone 1']).toBe('(804) 555-0142');
    expect(rows[2]['Zip']).toBe('23832');
    expect(rows[1]['E-mail 1']).toBe('');
  });

  it('feeds buildLeads end to end', () => {
    const { rows } = fixture();
    const mapping: VendorMapping = {
      vendor: 'sample',
      columns: {
        'Owner Name': { field: 'owner_full_name' },
        'Situs Address': { field: 'property_address' },
        'Mail Addr': { field: 'mailing_address' },
        LP: { field: 'list_price' },
        'Orig LP': { field: 'original_price' },
        CDOM: { field: 'days_on_market' },
        'Exp Date': { field: 'expired_date' },
        'List Office': { field: 'listing_office' },
        'Phone 1': { field: 'phone', slot: 1 },
        'Phone 1 Type': { field: 'phone_type', slot: 1 },
        'Phone 1 DNC': { field: 'phone_dnc', slot: 1 },
        'Ph2 Status': { field: 'phone_dnc', slot: 2 },
        Line: { field: 'phone_type', slot: 1 },
        'Scrubbed On': { field: 'scrub_date' },
        'MLS #': { field: 'mls_number' },
        Zip: { field: 'property_zip' },
        'E-mail 1': { field: 'email' },
      },
      dncValues: { Y: 'do_not_call', N: 'callable', Clean: 'callable', DNC: 'do_not_call' },
    };
    const { leads, skipped } = buildLeads(rows, mapping);
    expect(skipped).toEqual([]);
    expect(leads).toHaveLength(3);
    expect(leads[0].normalizedAddress).toBe('4417 GROVE AVE 23221');
    expect(leads[0].phones).toEqual([
      { number: '+18045550142', position: 1, lineType: 'mobile', vendorDnc: 'do_not_call' },
    ]);
    expect(leads[1].phones[0]).toMatchObject({ number: '+18045550199', lineType: 'landline', vendorDnc: 'callable' });
    expect(leads[2].fields).toMatchObject({ list_price: 615000, days_on_market: 37, expired_date: '2026-11-13' });
  });
});

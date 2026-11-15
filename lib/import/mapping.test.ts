import { describe, expect, it } from 'vitest';
import { parseSheet } from './parse';
import { effectiveSlot, sampleValues, inferSlot, orphanSlotColumns, unmappedDncColumns, type VendorMapping } from './mapping';

describe('inferSlot', () => {
  it('takes the first integer in the header', () => {
    expect(inferSlot('Ph2 Status')).toBe(2);
    expect(inferSlot('Phone 1 DNC')).toBe(1);
    expect(inferSlot('Owner Name')).toBeUndefined();
  });
});

describe('unmappedDncColumns', () => {
  const m = (field: 'ignore' | 'phone_dnc'): VendorMapping => ({
    vendor: 'v', columns: { 'Ph2 Status': { field } }, dncValues: {},
  });
  it('lists flagged columns mapped to ignore or missing', () => {
    expect(unmappedDncColumns(m('ignore'), { 'Ph2 Status': 0.72 })).toEqual(['Ph2 Status']);
    expect(unmappedDncColumns({ vendor: 'v', columns: {}, dncValues: {} }, { 'Ph2 Status': 0.72 })).toEqual(['Ph2 Status']);
  });
  it('is empty when mapped to phone_dnc or flag is low', () => {
    expect(unmappedDncColumns(m('phone_dnc'), { 'Ph2 Status': 0.72 })).toEqual([]);
    expect(unmappedDncColumns(m('ignore'), { 'Ph2 Status': 0.2 })).toEqual([]);
  });
});

describe('slots', () => {
  it('defaults phone to 1 and dnc/type without a number to 0', () => {
    expect(effectiveSlot('Phone', { field: 'phone' })).toBe(1);
    expect(effectiveSlot('DNC', { field: 'phone_dnc' })).toBe(0);
    expect(effectiveSlot('Ph2 Status', { field: 'phone_dnc' })).toBe(2);
    expect(effectiveSlot('DNC', { field: 'phone_dnc', slot: 0 })).toBe(0);
  });
  it('finds dnc/type columns whose slot has no phone column', () => {
    const m: VendorMapping = {
      vendor: 'v',
      columns: {
        'Phone 1': { field: 'phone' },
        'DNC 2023 list': { field: 'phone_dnc' },
        'Phone 1 DNC': { field: 'phone_dnc' },
        'Owner DNC': { field: 'phone_dnc' },
      },
      dncValues: {},
    };
    expect(orphanSlotColumns(m)).toEqual(['DNC 2023 list']);
  });
});

describe('sampleValues', () => {
  it('returns a plain object of up to 5 non-blank values per header, __proto__ as an own key', () => {
    const csv = Buffer.from('__proto__,Phone\n,1\nx,2\ny,3\nz,4\nw,5\nv,6\nu,7\n');
    const { headers, rows } = parseSheet(
      csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength) as ArrayBuffer,
      'x.csv',
    );
    expect(Object.getPrototypeOf(rows[0])).toBeNull(); // internal rows stay null-prototype
    const samples = sampleValues(headers, rows);
    expect(Object.getPrototypeOf(samples)).toBe(Object.prototype);
    expect(Object.keys(samples)).toEqual(['__proto__', 'Phone']);
    expect(Object.getOwnPropertyDescriptor(samples, '__proto__')?.value).toEqual(['x', 'y', 'z', 'w', 'v']);
    expect(samples.Phone).toEqual(['1', '2', '3', '4', '5']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

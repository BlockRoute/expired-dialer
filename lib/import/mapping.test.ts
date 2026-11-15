import { beforeEach, describe, expect, it, vi } from 'vitest';

const jevMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/typesafe/client', () => ({ jev: jevMock }));

import { inferSlot, suggestMapping, unmappedDncColumns, type VendorMapping } from './mapping';

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

describe('suggestMapping', () => {
  beforeEach(() => {
    jevMock.mockReset();
  });

  it('asks both questions per column with 5 samples, capped at 6 in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    jevMock.mockImplementation(async (state: { column: { header: string } }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const h = state.column.header;
      return {
        field: { type: 'choice', choice: h === 'Ph2 Status' ? 'ignore' : 'phone', confidence: 0.9, probabilities: {} },
        dnc: { type: 'noul', noul: h === 'Ph2 Status' ? 0.72 : 0.01 },
      };
    });
    const headers = ['Ph2 Status', ...Array.from({ length: 9 }, (_, i) => `Phone ${i}`)];
    const rows = Array.from({ length: 8 }, (_, i) => Object.fromEntries(headers.map((h) => [h, `v${i}`])));
    const out = await suggestMapping(headers, rows);

    expect(jevMock).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(6);
    const [state, questions] = jevMock.mock.calls[0];
    expect(state.column.sample_values).toHaveLength(5);
    expect(state.all_column_headers).toEqual(headers);
    expect(Object.keys(questions).sort()).toEqual(['dnc', 'field']);
    expect(out.columns['Ph2 Status']).toMatchObject({ field: 'ignore', confidence: 0.9 });
    expect(out.columns['Phone 3']).toMatchObject({ field: 'phone', slot: 3 });
    expect(out.dncColumnFlags['Ph2 Status']).toBe(0.72);
  });
});

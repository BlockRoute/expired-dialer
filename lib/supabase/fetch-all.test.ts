import { describe, expect, it } from 'vitest';
import { fetchAll } from './fetch-all';

const source = (n: number, cap = 1000) => {
  const rows = Array.from({ length: n }, (_, i) => ({ i }));
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { page, calls };
};

describe('fetchAll', () => {
  it('reads past the 1,000-row cap in ordered pages', async () => {
    const { page, calls } = source(2500);
    const rows = await fetchAll(page);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toEqual({ i: 2499 });
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('an exact multiple of the page size takes one extra empty read', async () => {
    const { page, calls } = source(1000);
    expect(await fetchAll(page)).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });
  it('throws on an error', async () => {
    await expect(fetchAll(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom');
  });
});

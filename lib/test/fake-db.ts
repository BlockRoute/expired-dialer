// Test-only in-memory stand-in for the Supabase query builder: eq/is/in filters,
// select/insert/update, maybeSingle/single, and await. Every executed query is logged.
type Row = Record<string, unknown>;
export type QueryLog = { table: string; op: 'select' | 'insert' | 'update' | 'upsert'; payload?: Row | Row[]; filters: [string, unknown][] };

export function fakeDb(tables: Record<string, Row[]>, opts: { failInsert?: string[] } = {}) {
  const log: QueryLog[] = [];
  let nextId = 1;
  function from(table: string) {
    const filters: [string, unknown][] = [];
    const inFilters: [string, unknown[]][] = [];
    let op: QueryLog['op'] = 'select';
    let payload: Row | Row[] | undefined;
    const rows = () =>
      (tables[table] ?? []).filter(
        (r) =>
          filters.every(([c, v]) => (r[c] ?? null) === v) &&
          inFilters.every(([c, vs]) => vs.includes(r[c])),
      );
    const exec = () => {
      log.push({ table, op, payload, filters: [...filters] });
      if (op === 'insert') {
        if (opts.failInsert?.includes(table)) return { data: null, error: { code: '23505', message: 'insert failed' } };
        const added = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `new-${table}-${nextId++}`, ...p }));
        (tables[table] ??= []).push(...added);
        return { data: added, error: null };
      }
      if (op === 'update') {
        for (const r of rows()) Object.assign(r, payload);
        return { data: null, error: null };
      }
      if (op === 'upsert') {
        for (const p of payload as Row[]) {
          const r = (tables[table] ??= []).find((x) => x.id === p.id);
          if (r) Object.assign(r, p);
          else tables[table].push(p);
        }
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    };
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const m of ['select', 'order', 'limit', 'range', 'not', 'gte']) q[m] = self;
    q.eq = (c: string, v: unknown) => (filters.push([c, v]), q);
    q.is = (c: string, v: unknown) => (filters.push([c, v]), q);
    q.in = (c: string, vs: unknown[]) => (inFilters.push([c, vs]), q);
    q.insert = (row: Row) => ((op = 'insert'), (payload = row), q);
    q.update = (patch: Row) => ((op = 'update'), (payload = patch), q);
    q.upsert = (rows: Row[]) => ((op = 'upsert'), (payload = rows), q);
    q.maybeSingle = async () => {
      const r = exec();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
    };
    q.single = q.maybeSingle;
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej);
    return q;
  }
  return { client: { from }, log, tables };
}

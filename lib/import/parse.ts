import * as XLSX from 'xlsx';

/** Parse .xlsx/.xls/.csv into headers + rows; every cell is a trimmed string. */
export function parseSheet(
  data: ArrayBuffer,
  filename: string,
): { headers: string[]; rows: Record<string, string>[] } {
  const isCsv = /\.(csv|txt)$/i.test(filename);
  // CSV: raw keeps text as-is (no date/number coercion, zip leading zeros survive).
  const wb = XLSX.read(data, { type: 'array', raw: isCsv });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (grid.length === 0) return { headers: [], rows: [] };

  const seen = new Map<string, number>();
  const headers = (grid[0] as unknown[]).map((cell, i) => {
    const base = String(cell ?? '').trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = grid.slice(1).map((r) => {
    // Null prototype: a header named __proto__ stays an ordinary key.
    const out: Record<string, string> = Object.create(null);
    headers.forEach((h, i) => {
      out[h] = String((r as unknown[])[i] ?? '').trim();
    });
    return out;
  });
  return { headers, rows: rows.filter((r) => Object.values(r).some((v) => v !== '')) };
}

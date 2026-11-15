'use client';

import { useMemo, useState } from 'react';
import { buildLeads, mostCommonScrubDate, type ImportedLead } from '@/lib/import/build';
import {
  FIELD_KEYS,
  PHONE_FIELDS,
  inferSlot,
  orphanSlotColumns,
  sampleValues,
  unmappedDncColumns,
  type ColumnTarget,
  type DncValue,
  type FieldKey,
  type VendorMapping,
} from '@/lib/import/mapping';
import { parseSheet } from '@/lib/import/parse';
import {
  applyImport,
  createBatch,
  finishBatch,
  loadMapping,
  saveMapping,
  suggestDncValues,
  suggestMappingAction,
} from './actions';

const SEND_CHUNK = 200; // keeps each server-action payload well under the 1 MB body limit
const input = 'rounded border border-neutral-300 px-2 py-1 text-sm';

type Parsed = { fileName: string; headers: string[]; rows: Record<string, string>[] };
type Result = { created: number; updated: number; phonesAdded: number; dncPhones: number; skipped: number };

export function ImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [vendor, setVendor] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [columns, setColumns] = useState<Record<string, ColumnTarget>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [flags, setFlags] = useState<Record<string, number>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dncValues, setDncValues] = useState<Record<string, DncValue>>({});
  const [scrubDate, setScrubDate] = useState('');
  const [scrubbedByVendor, setScrubbedByVendor] = useState(false);
  const [source, setSource] = useState<'saved' | 'suggested' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const mapping: VendorMapping = useMemo(
    () => ({ vendor: vendor.trim(), columns, dncValues }),
    [vendor, columns, dncValues],
  );
  const blocking = useMemo(
    () => unmappedDncColumns(mapping, flags).filter((h) => !dismissed.has(h)),
    [mapping, flags, dismissed],
  );
  const dncCells = useMemo(() => {
    if (!parsed) return [] as { column: string; value: string }[];
    const seen = new Map<string, string>();
    for (const [h, t] of Object.entries(columns)) {
      if (t.field !== 'phone_dnc') continue;
      for (const r of parsed.rows) {
        const v = (r[h] ?? '').trim();
        if (v && !seen.has(v)) seen.set(v, h);
      }
    }
    return [...seen].map(([value, column]) => ({ column, value }));
  }, [parsed, columns]);
  const missingDnc = dncCells.filter((c) => !(c.value in dncValues));
  const built = useMemo(
    () => (parsed ? buildLeads(parsed.rows, mapping) : null),
    [parsed, mapping],
  );
  const unmappedHeaders = parsed ? parsed.headers.filter((h) => !(h in columns)) : [];
  const orphans = useMemo(() => orphanSlotColumns(mapping), [mapping]);
  const hasPhoneColumn = Object.values(columns).some((t) => t.field === 'phone');
  const canImport =
    !busy && !!built && !!vendor.trim() && !!scrubDate && hasPhoneColumn && blocking.length === 0 &&
    missingDnc.length === 0 && unmappedHeaders.length === 0 && orphans.length === 0 && !result;

  async function readFile() {
    if (!file || !vendor.trim()) return;
    setBusy('Reading file...');
    setError(null);
    setResult(null);
    try {
      const { headers, rows } = parseSheet(await file.arrayBuffer(), file.name);
      if (headers.length === 0) throw new Error('No rows found in that file.');
      setParsed({ fileName: file.name, headers, rows });
      setDismissed(new Set());

      const saved = await loadMapping(vendor);
      let nextColumns: Record<string, ColumnTarget>;
      let nextDnc: Record<string, DncValue> = {};
      if (saved) {
        nextColumns = { ...saved.columns };
        nextDnc = saved.dncValues;
        setConfidence({});
        setFlags({});
        setSource('saved');
        const fresh = headers.filter((h) => !(h in nextColumns));
        if (fresh.length > 0) {
          // New or renamed headers must be classified, including the DNC check.
          setBusy('Checking new columns with Jev...');
          const s = await suggestMappingAction(headers, sampleValues(headers, rows), fresh);
          if (s.ok) {
            for (const [h, t] of Object.entries(s.columns)) nextColumns[h] = { field: t.field, slot: t.slot };
            setConfidence(Object.fromEntries(Object.entries(s.columns).map(([h, t]) => [h, t.confidence])));
            setFlags(s.dncColumnFlags);
          } else {
            setError(`Jev could not check the new columns (${s.error}). Choose a field for each one.`);
          }
        }
      } else {
        setBusy('Asking Jev to map the columns...');
        const s = await suggestMappingAction(headers, sampleValues(headers, rows));
        if (s.ok) {
          nextColumns = Object.fromEntries(
            Object.entries(s.columns).map(([h, t]) => [h, { field: t.field, slot: t.slot }]),
          );
          setConfidence(Object.fromEntries(Object.entries(s.columns).map(([h, t]) => [h, t.confidence])));
          setFlags(s.dncColumnFlags);
        } else {
          setError(`Jev could not suggest a mapping (${s.error}). Map the columns by hand.`);
          nextColumns = {}; // every column must be chosen explicitly
          setConfidence({});
          setFlags({});
        }
        setSource('suggested');
      }
      setColumns(nextColumns);
      setDncValues(nextDnc);
      setScrubDate(mostCommonScrubDate(rows, { vendor, columns: nextColumns, dncValues: nextDnc }) ?? '');
      if (!saved) await readDncValues(rows, nextColumns, nextDnc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function readDncValues(
    rows: Record<string, string>[],
    cols: Record<string, ColumnTarget>,
    known: Record<string, DncValue>,
  ) {
    const seen = new Map<string, string>();
    for (const [h, t] of Object.entries(cols)) {
      if (t.field !== 'phone_dnc') continue;
      for (const r of rows) {
        const v = (r[h] ?? '').trim();
        if (v && !(v in known) && !seen.has(v)) seen.set(v, h);
      }
    }
    if (seen.size === 0) return;
    setBusy('Asking Jev what the DNC values mean...');
    const read = await suggestDncValues([...seen].map(([value, column]) => ({ column, value })));
    setDncValues((d) => ({ ...d, ...read }));
  }

  function setField(header: string, field: FieldKey) {
    setColumns((c) => {
      const t: ColumnTarget = { field };
      if (PHONE_FIELDS.includes(field)) t.slot = c[header]?.slot ?? inferSlot(header);
      return { ...c, [header]: t };
    });
  }

  async function runImport() {
    if (!parsed || !built) return;
    setBusy('Importing...');
    setError(null);
    try {
      await saveMapping(mapping);
      const batchId = await createBatch({
        fileName: parsed.fileName,
        vendor,
        scrubDate,
        scrubbedByVendor,
        totalRows: parsed.rows.length,
      });
      const totals = { created: 0, updated: 0, phonesAdded: 0, dncPhones: 0 };
      const leads: ImportedLead[] = built.leads;
      for (let i = 0; i < leads.length; i += SEND_CHUNK) {
        setBusy(`Importing ${Math.min(i + SEND_CHUNK, leads.length)} of ${leads.length}...`);
        const r = await applyImport(batchId, leads.slice(i, i + SEND_CHUNK));
        for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
      }
      await finishBatch(batchId, {
        created: totals.created,
        updated: totals.updated,
        skipped: built.skipped.length,
        phonesAdded: totals.phonesAdded,
      });
      setResult({ ...totals, skipped: built.skipped.length });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const samples = (h: string) =>
    (parsed?.rows ?? [])
      .map((r) => r[h])
      .filter(Boolean)
      .slice(0, 3)
      .join(' | ');

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-neutral-600">Vendor name</span>
          <input className={input} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. RedX" />
        </label>
        <label className="text-sm">
          <span className="block text-neutral-600">Spreadsheet (.xlsx, .xls, .csv)</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          disabled={!file || !vendor.trim() || !!busy}
          onClick={readFile}
        >
          Read file
        </button>
      </section>

      {busy && <p className="text-sm text-neutral-600">{busy}</p>}
      {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {parsed && (
        <>
          <section className="space-y-2">
            <h2 className="font-medium">
              Columns{' '}
              <span className="text-sm font-normal text-neutral-600">
                {source === 'saved' ? `(saved mapping for ${vendor})` : '(suggested by Jev, edit as needed)'}
              </span>
            </h2>

            {blocking.map((h) => (
              <div
                key={h}
                className="flex items-center justify-between gap-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm"
              >
                <span>
                  <strong>{h}</strong> looks like a do-not-call column (
                  {Math.round((flags[h] ?? 0) * 100)}%) but is not mapped to one. Map it to
                  &ldquo;phone_dnc&rdquo; or dismiss it.
                </span>
                <span className="flex shrink-0 gap-2">
                  <button className="rounded border px-2 py-1" onClick={() => setField(h, 'phone_dnc')}>
                    Map to phone_dnc
                  </button>
                  <button
                    className="rounded border px-2 py-1"
                    onClick={() => setDismissed((d) => new Set(d).add(h))}
                  >
                    Dismiss
                  </button>
                </span>
              </div>
            ))}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-300 text-neutral-600">
                  <tr>
                    <th className="py-1 pr-3">Header</th>
                    <th className="py-1 pr-3">Sample values</th>
                    <th className="py-1 pr-3">Field</th>
                    <th className="py-1 pr-3">Slot</th>
                    <th className="py-1">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.headers.map((h) => (
                    <tr key={h} className="border-b border-neutral-100">
                      <td className="py-1 pr-3 font-medium">{h}</td>
                      <td className="max-w-xs truncate py-1 pr-3 text-neutral-600">{samples(h)}</td>
                      <td className="py-1 pr-3">
                        <select
                          className={input}
                          value={columns[h]?.field ?? ''}
                          onChange={(e) => setField(h, e.target.value as FieldKey)}
                        >
                          {!(h in columns) && <option value="">Choose...</option>}
                          {FIELD_KEYS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-3">
                        {PHONE_FIELDS.includes(columns[h]?.field ?? 'ignore') ? (
                          <input
                            type="number"
                            min={0}
                            className={`${input} w-16`}
                            placeholder={columns[h]?.field === 'phone' ? '1' : 'all'}
                            title="0 or blank (no number in header) = applies to all phones in the row"
                            value={columns[h]?.slot ?? ''}
                            onChange={(e) =>
                              setColumns((c) => ({
                                ...c,
                                [h]: { ...c[h], slot: e.target.value !== '' ? Number(e.target.value) : undefined },
                              }))
                            }
                          />
                        ) : null}
                      </td>
                      <td className="py-1 text-neutral-600">
                        {h in confidence ? `${Math.round(confidence[h] * 100)}%` : '-'}
                        {(flags[h] ?? 0) >= 0.5 && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-900">DNC?</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {(dncCells.length > 0 || Object.keys(dncValues).length > 0) && (
            <section className="space-y-2">
              <h2 className="font-medium">Do-not-call values</h2>
              <p className="text-sm text-neutral-600">
                Confirm what each value in the DNC columns means. Every value must have a meaning before you can import. Blank cells are treated as unknown.
              </p>
              <table className="text-left text-sm">
                <thead className="border-b border-neutral-300 text-neutral-600">
                  <tr>
                    <th className="py-1 pr-6">Value in file</th>
                    <th className="py-1">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {[...new Set([...dncCells.map((c) => c.value), ...Object.keys(dncValues)])].map((v) => (
                    <tr key={v} className="border-b border-neutral-100">
                      <td className="py-1 pr-6 font-mono">{v}</td>
                      <td className="py-1">
                        <select
                          className={input}
                          value={dncValues[v] ?? ''}
                          onChange={(e) => setDncValues((d) => ({ ...d, [v]: e.target.value as DncValue }))}
                        >
                          {!(v in dncValues) && <option value="">Choose...</option>}
                          <option value="do_not_call">do not call</option>
                          <option value="callable">callable</option>
                          <option value="unknown">unknown</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {missingDnc.length > 0 && (
                <button
                  className="rounded border px-2 py-1 text-sm disabled:opacity-40"
                  disabled={!!busy}
                  onClick={async () => {
                    setError(null);
                    try {
                      await readDncValues(parsed.rows, columns, dncValues);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Ask Jev about {missingDnc.length} new value{missingDnc.length === 1 ? '' : 's'}
                </button>
              )}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-medium">Batch</h2>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <span className="block text-neutral-600">Scrub date (required)</span>
                <input
                  type="date"
                  required
                  className={input}
                  value={scrubDate}
                  onChange={(e) => setScrubDate(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 pb-1 text-sm">
                <input
                  type="checkbox"
                  checked={scrubbedByVendor}
                  onChange={(e) => setScrubbedByVendor(e.target.checked)}
                />
                Scrubbed by vendor
              </label>
            </div>
            <p className="text-xs text-neutral-500">
              The date the vendor checked the list against do-not-call registries, usually the purchase date.
            </p>

            {built && (
              <p className="text-sm">
                {parsed.rows.length} rows: <strong>{built.leads.length}</strong> leads,{' '}
                {built.leads.reduce((n, l) => n + l.phones.length, 0)} phones,{' '}
                {built.leads.filter((l) => l.outOfState).length} out of state, {built.skipped.length} skipped (
                {built.skipped.filter((s) => s.reason === 'no_address').length} no address,{' '}
                {built.skipped.filter((s) => s.reason === 'no_valid_phone').length} no valid phone).
              </p>
            )}
            {unmappedHeaders.length > 0 && (
              <p className="text-sm text-amber-800">
                Choose a field for {unmappedHeaders.length} unmapped column{unmappedHeaders.length === 1 ? '' : 's'}:{' '}
                {unmappedHeaders.join(', ')}.
                <button
                  className="ml-2 rounded border px-2 py-0.5"
                  onClick={() =>
                    setColumns((c) => ({
                      ...c,
                      ...Object.fromEntries(unmappedHeaders.map((h) => [h, { field: 'ignore' as FieldKey }])),
                    }))
                  }
                >
                  Ignore all of them
                </button>
              </p>
            )}
            {orphans.length > 0 && (
              <p className="text-sm text-amber-800">
                {orphans.join(', ')}: no phone column has that slot. Set the slot to match a phone column, or 0 to apply
                it to every phone in the row.
              </p>
            )}
            {missingDnc.length > 0 && (
              <p className="text-sm text-amber-800">
                {missingDnc.length} do-not-call value{missingDnc.length === 1 ? ' needs' : 's need'} a meaning above.
              </p>
            )}
            {!hasPhoneColumn && <p className="text-sm text-red-700">Map at least one column to phone.</p>}
            {blocking.length > 0 && (
              <p className="text-sm text-amber-800">
                Resolve the do-not-call column warning{blocking.length === 1 ? '' : 's'} above to import.
              </p>
            )}

            <button
              className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={!canImport}
              onClick={runImport}
            >
              Save mapping and import
            </button>
          </section>
        </>
      )}

      {result && (
        <section className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm">
          Imported: {result.created} new leads, {result.updated} updated, {result.phonesAdded} phones added (
          {result.dncPhones} flagged do-not-call), {result.skipped} rows skipped.
        </section>
      )}
    </div>
  );
}

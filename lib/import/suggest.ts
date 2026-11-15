import type { JevAnswers } from '@/lib/typesafe/client';
import { jev } from '@/lib/typesafe/client';
import { columnFieldChoice, dncColumnNoul, dncValueChoice } from '@/lib/typesafe/questions';
import { FIELDS, PHONE_FIELDS, inferSlot, type ColumnTarget, type DncValue, type FieldKey } from './mapping';

// Server-only: imports the Jev client. Import from server actions only.

const MAX_IN_FLIGHT = 6;
const SAMPLE_COUNT = 5;

/** One Jev request per column (or only `only`) (field Choice + DNC-column Noul), max 6 in flight. */
export async function suggestMapping(
  headers: string[],
  rows: Record<string, string>[],
  only?: string[],
): Promise<{
  columns: Record<string, ColumnTarget & { confidence: number }>;
  dncColumnFlags: Record<string, number>;
}> {
  const questions = { field: columnFieldChoice(FIELDS), dnc: dncColumnNoul() };
  const columns: Record<string, ColumnTarget & { confidence: number }> = {};
  const dncColumnFlags: Record<string, number> = {};

  const targets = only ?? headers;
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const header = targets[next++];
      const samples = rows
        .map((r) => r[header] ?? '')
        .filter((v) => v !== '')
        .slice(0, SAMPLE_COUNT);
      const state = {
        file: 'Expired-listing lead export purchased from a lead vendor',
        all_column_headers: headers,
        column: { header, sample_values: samples },
      };
      const answers: JevAnswers = await jev(state, questions);
      const f = answers.field;
      const choice = f?.type === 'choice' && f.choice in FIELDS ? (f.choice as FieldKey) : 'ignore';
      const confidence = f?.type === 'choice' ? f.confidence : 0;
      const target: ColumnTarget & { confidence: number } = { field: choice, confidence };
      if (PHONE_FIELDS.includes(choice)) {
        const slot = inferSlot(header);
        if (slot !== undefined) target.slot = slot;
      }
      columns[header] = target;
      const d = answers.dnc;
      dncColumnFlags[header] = d?.type === 'noul' ? d.noul : 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, targets.length) }, worker));
  return { columns, dncColumnFlags };
}

/** Jev's reading of each distinct DNC value. Values Jev fails on are omitted so they stay unconfirmed. */
export async function classifyDncValues(
  items: { column: string; value: string }[],
): Promise<Record<string, DncValue>> {
  const out: Record<string, DncValue> = {};
  const question = { meaning: dncValueChoice() };
  await Promise.all(
    items.map(async ({ column, value }) => {
      try {
        const a = await jev({ column_header: column, cell_value: value }, question);
        const m = a.meaning;
        const c = m?.type === 'choice' ? m.choice : 'unknown';
        out[value] = c === 'do_not_call' || c === 'callable' ? c : 'unknown';
      } catch {
        // leave unconfirmed
      }
    }),
  );
  return out;
}

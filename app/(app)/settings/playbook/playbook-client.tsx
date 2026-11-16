'use client';

import { useState, useTransition } from 'react';
import type { PlaybookCardRow } from '@/lib/db/types';
import { saveCard, setCardActive, testCard, type TestResult } from './actions';

const input = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm';

type Draft = { id?: string; key: string; title: string; criteria: string; say: string; why: string };
const EMPTY: Draft = { key: '', title: '', criteria: '', say: '', why: '' };

export function PlaybookClient({ cards }: { cards: PlaybookCardRow[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [line, setLine] = useState('');
  const [intended, setIntended] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);

  const edit = (c: PlaybookCardRow) => {
    setDraft({ id: c.id, key: c.key, title: c.title, criteria: c.criteria ?? '', say: c.say ?? '', why: c.why ?? '' });
    setTest(null);
    setIntended(c.key);
  };

  const save = () =>
    start(async () => {
      if (!draft) return;
      const r = await saveCard(draft);
      setError(r.ok ? null : r.error);
      if (r.ok) setDraft(null);
    });

  const toggle = (c: PlaybookCardRow) =>
    start(async () => {
      const r = await setCardActive(c.id, !c.active);
      setError(r.ok ? null : r.error);
    });

  const runTest = () =>
    start(async () => {
      if (!draft) return;
      setTest(
        await testCard({
          line,
          candidateKey: draft.key || 'new_card',
          candidateCriteria: draft.criteria,
          intendedKey: intended || draft.key || 'new_card',
        }),
      );
    });

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Cards ({cards.filter((c) => c.active).length} active)</h2>
        <button onClick={() => { setDraft(EMPTY); setTest(null); setIntended(''); setError(null); }} className="rounded bg-neutral-900 px-3 py-1 text-sm text-white">
          Add card
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}

      <ul className="divide-y divide-neutral-200 text-sm">
        {cards.map((c) => (
          <li key={c.id} className={`flex items-start gap-3 py-2 ${c.active ? '' : 'opacity-50'}`}>
            <div className="min-w-0 flex-1">
              <div>
                <span className="font-medium">{c.title}</span> <span className="font-mono text-xs text-neutral-500">{c.key}</span>
              </div>
              <div className="text-neutral-600">{c.criteria}</div>
            </div>
            <button onClick={() => edit(c)} className="underline">
              Edit
            </button>
            <button onClick={() => toggle(c)} disabled={pending} className="underline">
              {c.active ? 'Deactivate' : 'Activate'}
            </button>
          </li>
        ))}
      </ul>

      {draft && (
        <div className="space-y-3 rounded border border-neutral-300 p-4">
          <h3 className="font-medium">{draft.id ? 'Edit card' : 'New card'}</h3>
          <label className="block text-sm">
            Key {draft.id ? '(fixed)' : '(lowercase slug, cannot change later)'}
            <input className={input} value={draft.key} onChange={set('key')} disabled={!!draft.id} />
          </label>
          <label className="block text-sm">
            Title
            <input className={input} value={draft.title} onChange={set('title')} />
          </label>
          <label className="block text-sm">
            Criteria (when Jev should pick this card)
            <textarea className={input} rows={3} value={draft.criteria} onChange={set('criteria')} />
          </label>
          <label className="block text-sm">
            Say
            <textarea className={input} rows={3} value={draft.say} onChange={set('say')} />
          </label>
          <label className="block text-sm">
            Why
            <textarea className={input} rows={2} value={draft.why} onChange={set('why')} />
          </label>
          <div className="flex gap-3">
            <button onClick={save} disabled={pending} className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">
              Save card
            </button>
            <button onClick={() => setDraft(null)} className="text-sm underline">
              Cancel
            </button>
          </div>

          <div className="space-y-2 border-t border-neutral-200 pt-3">
            <h4 className="text-sm font-medium">Test this card</h4>
            <input className={input} placeholder="Something an owner might say" value={line} onChange={(e) => setLine(e.target.value)} />
            <label className="block text-sm">
              This line is meant for
              <select className={input} value={intended || draft.key} onChange={(e) => setIntended(e.target.value)}>
                <option value={draft.key}>this card</option>
                {cards.filter((c) => c.key !== draft.key).map((c) => (
                  <option key={c.id} value={c.key}>
                    {c.title}
                  </option>
                ))}
                <option value="none">none</option>
              </select>
            </label>
            <button onClick={runTest} disabled={pending || !line.trim() || !draft.criteria.trim()} className="rounded border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50">
              {pending ? 'Testing...' : 'Test'}
            </button>
            {test && !test.ok && <p className="text-sm text-red-700">{test.error}</p>}
            {test?.ok && (
              <div className="text-sm">
                <ol className="list-decimal pl-5">
                  {test.top.map((t) => (
                    <li key={t.key}>
                      <span className="font-mono">{t.key}</span> {t.p.toFixed(2)}
                    </li>
                  ))}
                </ol>
                {test.warning && <p className="mt-1 text-amber-700">{test.warning}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

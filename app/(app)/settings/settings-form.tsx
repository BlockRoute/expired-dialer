'use client';

import { useState, useTransition } from 'react';
import type { Hours, SettingsRow } from '@/lib/db/types';
import { outcomeLabel } from '@/lib/outcomes';
import { ALL_OUTCOMES, DAY_KEYS, RING_OPTIONS } from '@/lib/settings';
import { saveSettings } from './actions';

const input = 'rounded border border-neutral-300 px-2 py-1 text-sm';

export function SettingsForm({ settings }: { settings: SettingsRow }) {
  const [callerId, setCallerId] = useState(settings.caller_id ?? '');
  const [hours, setHours] = useState<Hours>(settings.hours);
  const [rounds, setRounds] = useState(settings.max_rounds);
  const [gap, setGap] = useState(settings.round_gap_hours);
  const [ring, setRing] = useState(settings.ring_timeout_s);
  const [outcomes, setOutcomes] = useState<string[]>(settings.outcomes);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const setDay = (day: keyof Hours, idx: 0 | 1, value: string) =>
    setHours((h) => {
      const w = h[day] ?? ['09:00', '20:00'];
      const next: [string, string] = [w[0], w[1]];
      next[idx] = value;
      return { ...h, [day]: next };
    });

  const save = () =>
    start(async () => {
      const r = await saveSettings({
        caller_id: callerId,
        hours,
        max_rounds: rounds,
        round_gap_hours: gap,
        ring_timeout_s: ring,
        outcomes,
      });
      setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
    });

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h2 className="font-medium">Caller ID</h2>
        <input
          className={`${input} w-56`}
          value={callerId}
          onChange={(e) => setCallerId(e.target.value)}
          placeholder="(804) 555-0100"
          aria-label="Caller ID"
        />
        <p className="text-xs text-neutral-500">Leave blank to use the TWILIO_CALLER_ID environment variable.</p>
      </div>

      <div className="space-y-2">
        <h2 className="font-medium">Calling hours (Eastern, 08:00 to 21:00 at most)</h2>
        {DAY_KEYS.map((day) => {
          const w = hours[day];
          return (
            <div key={day} className="flex items-center gap-3 text-sm">
              <span className="w-10 uppercase">{day}</span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={w !== null}
                  onChange={(e) => setHours((h) => ({ ...h, [day]: e.target.checked ? ['09:00', '20:00'] : null }))}
                />
                Open
              </label>
              {w && (
                <>
                  <input type="time" min="08:00" max="21:00" className={input} value={w[0]} onChange={(e) => setDay(day, 0, e.target.value)} aria-label={`${day} open`} />
                  <span>to</span>
                  <input type="time" min="08:00" max="21:00" className={input} value={w[1]} onChange={(e) => setDay(day, 1, e.target.value)} aria-label={`${day} close`} />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h2 className="font-medium">Retry rules</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            Rounds
            <input type="number" min={1} max={5} className={`${input} w-16`} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-2">
            Gap (hours)
            <input type="number" min={1} max={48} className={`${input} w-16`} value={gap} onChange={(e) => setGap(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-2">
            Ring timeout
            <select className={input} value={ring} onChange={(e) => setRing(Number(e.target.value))}>
              {RING_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="font-medium">Outcomes</h2>
        <p className="text-xs text-neutral-500">Turn outcomes on or off. DNC always stays on.</p>
        <div className="grid grid-cols-2 gap-1 text-sm">
          {ALL_OUTCOMES.map((o) => (
            <label key={o} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={outcomes.includes(o)}
                disabled={o === 'dnc'}
                onChange={(e) => setOutcomes((cur) => (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)))}
              />
              {outcomeLabel(o)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={pending} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? 'Saving...' : 'Save settings'}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</span>}
      </div>
    </section>
  );
}

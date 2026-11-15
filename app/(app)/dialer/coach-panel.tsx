'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoachAction } from '@/lib/db/types';
import type { OwnerTurn } from '@/lib/transcript';
import { recordCoachAction } from './actions';

type CoachCard = { key: string; title: string; say: string; why?: string; source: 'jev' | 'claude' };
type CoachResponse = {
  turnId: number;
  cards: CoachCard[];
  dncP: number | null;
  paused?: boolean;
  coachCardId?: string | null;
};

export const DNC_THRESHOLD = 0.5;

/**
 * Live coaching cards for the owner's latest turn. Responses for an older turn
 * than the newest request are dropped. Reports a DNC request upward through
 * `onDncRequest`; the dialer decides what to do with it.
 */
export function CoachPanel(props: {
  callId: string | null;
  leadId: string;
  onOwnerTurn: (cb: (turn: OwnerTurn) => void) => void;
  onDncRequest: (requested: boolean) => void;
}) {
  const { callId, leadId, onOwnerTurn, onDncRequest } = props;
  const [response, setResponse] = useState<CoachResponse | null>(null);
  const [acted, setActed] = useState<CoachAction | null>(null);
  const [paused, setPaused] = useState(false);
  const latest = useRef(-1);
  const ids = useRef({ callId, leadId });
  const dncRef = useRef(onDncRequest);
  useEffect(() => {
    ids.current = { callId, leadId };
    dncRef.current = onDncRequest;
  });

  useEffect(() => {
    onOwnerTurn((turn) => {
      const { callId: cid, leadId: lid } = ids.current;
      if (!cid) return;
      if (turn.turnId === 0) latest.current = -1; // a new call's transcription session
      latest.current = Math.max(latest.current, turn.turnId);
      void (async () => {
        try {
          const res = await fetch('/api/coach', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ callId: cid, leadId: lid, turn }),
          });
          if (!res.ok) throw new Error('coach request failed');
          const body = (await res.json()) as CoachResponse;
          if (body.turnId < latest.current) return;
          if (body.paused) {
            setPaused(true);
            return;
          }
          setPaused(false);
          setResponse(body);
          setActed(null);
          if (body.dncP != null && body.dncP >= DNC_THRESHOLD) dncRef.current(true);
        } catch {
          setPaused(true);
        }
      })();
    });
    return () => onOwnerTurn(() => {});
  }, [onOwnerTurn]);

  const act = (action: CoachAction) => {
    setActed(action);
    if (response?.coachCardId) void recordCoachAction(response.coachCardId, action).catch(() => {});
  };

  const cards = response?.cards ?? [];
  const btn = 'rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100';

  return (
    <section className="space-y-2 rounded border border-neutral-300 p-4" aria-label="Coaching">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Coach</h2>
        {paused && <span className="text-xs text-amber-800">coaching paused</span>}
      </div>
      {cards.length === 0 ? (
        <p className="text-sm text-neutral-500">Listening...</p>
      ) : (
        <ul className={`gap-2 ${cards.length > 1 ? 'grid sm:grid-cols-2' : 'flex flex-col'} ${acted ? 'opacity-50' : ''}`}>
          {cards.map((c, i) => (
            <li key={c.key} className="space-y-1 rounded border border-neutral-200 p-3" data-testid="coach-card">
              <p className="text-sm font-medium">
                {c.title}
                {c.source === 'claude' && <span className="ml-2 text-xs font-normal text-neutral-500">AI-written</span>}
              </p>
              <p className="text-sm">{c.say}</p>
              {c.why && <p className="text-xs text-neutral-500">{c.why}</p>}
              {!acted && (
                <div className="flex gap-2 pt-1">
                  <button type="button" className={btn} onClick={() => act(i === 0 ? 'used' : 'switched')}>
                    {i === 0 ? 'Use' : 'Switch'}
                  </button>
                  {i === 0 && (
                    <button type="button" className={btn} onClick={() => act('dismissed')}>
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

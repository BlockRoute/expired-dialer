'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoachAction } from '@/lib/db/types';
import type { OwnerTurn } from '@/lib/transcript';
import { resolveCoachResponse, type PanelResponse } from '@/lib/coach/panel-state';
import { recordCoachAction } from './actions';

type CoachResponse = PanelResponse;

/**
 * Live coaching cards for the owner's latest turn. Responses for an older turn
 * than the newest request are dropped. Reports a DNC request upward through
 * `onDncRequest`; the dialer decides what to do with it.
 */
export function CoachPanel(props: {
  callId: string | null;
  leadId: string;
  onOwnerTurn: (cb: (turn: OwnerTurn) => void) => void;
  onDncRequest: (callId: string) => void;
}) {
  const { callId, leadId, onOwnerTurn, onDncRequest } = props;
  const [response, setResponse] = useState<{ cards: CoachResponse['cards']; coachCardId: string | null } | null>(null);
  const [acted, setActed] = useState<CoachAction | null>(null);
  const [paused, setPaused] = useState(false);
  const latest = useRef(-1);
  const mounted = useRef(true);
  const ids = useRef({ callId, leadId });
  const dncRef = useRef(onDncRequest);
  useEffect(() => {
    ids.current = { callId, leadId };
    dncRef.current = onDncRequest;
  });

  useEffect(() => {
    mounted.current = true;
    onOwnerTurn((turn) => {
      const { callId: cid, leadId: lid } = ids.current;
      if (!cid) return;
      if (turn.turnId === 0) latest.current = -1; // a new call's transcription session
      latest.current = Math.max(latest.current, turn.turnId);
      void (async () => {
        let body: CoachResponse | null = null;
        try {
          const res = await fetch('/api/coach', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ callId: cid, leadId: lid, turn }),
          });
          if (res.ok) body = (await res.json()) as CoachResponse;
        } catch {
          body = null;
        }
        const { reportDnc, view } = resolveCoachResponse({
          latestTurnId: latest.current,
          currentCallId: ids.current.callId,
          requestCallId: cid,
          turnId: turn.turnId,
          response: body,
        });
        if (reportDnc) dncRef.current(cid);
        if (!mounted.current) return;
        if (view.kind === 'paused') {
          setPaused(true);
          setResponse(null);
        } else if (view.kind === 'cards') {
          setPaused(false);
          setResponse({ cards: view.cards, coachCardId: view.coachCardId });
          setActed(null);
        }
      })();
    });
    return () => {
      mounted.current = false; // late responses still report DNC for their call, but render nothing
      onOwnerTurn(() => {});
    };
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

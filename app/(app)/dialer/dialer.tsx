'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Call, Device } from '@twilio/voice-sdk';
import { loadDeviceCtor } from '@/lib/dialer/device';
import {
  canDial,
  canSaveOutcome,
  canSkip,
  currentLead,
  currentPhone,
  flowReducer,
  initialFlow,
  savedLeavesRoundOpen,
  type FlowLead,
} from '@/lib/dialer/flow';
import { checkDial, type BlockReason } from '@/lib/guardrails';
import { outcomeLabel, PRIMARY_OUTCOMES } from '@/lib/outcomes';
import type { ImportBatchRow, SettingsRow } from '@/lib/db/types';
import { closeRound, lookupCallId, saveOutcome } from './actions';
import { markLeadDnc } from '../leads/actions';
import type { Prefill } from '@/lib/postcall/prefill';
import { dncAppliesToCall } from '@/lib/coach/panel-state';
import { CoachPanel } from './coach-panel';
import { CmaPanel, prefetchCma } from './cma-panel';
import { useTranscription } from './use-transcription';

type DeviceStatus = 'loading' | 'ready' | 'error';

/** Twilio SDK errors carry a numeric code (e.g. 20101 invalid token, 31208 mic denied); show it. */
function describeError(error: unknown): string {
  console.error('[dialer]', error);
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; name?: unknown; message?: unknown };
    const parts = [e.code, e.name, e.message].filter((p) => typeof p === 'string' || typeof p === 'number');
    if (parts.length) return parts.join(' ');
  }
  return typeof error === 'string' && error ? error : 'unknown error';
}

const BLOCK_TEXT: Record<BlockReason, string> = {
  vendor_dnc: 'Vendor flagged do-not-call',
  internal_dnc: 'On your internal DNC list',
  unscrubbed: 'Not DNC-scrubbed',
  scrub_stale: 'DNC scrub is over 90 days old',
  outside_hours: 'Outside calling hours',
  out_of_state: 'Out of state',
  lead_closed: 'Lead is closed',
  dnc_review: 'Possible DNC request: review it on the lead page',
  phone_dead: 'Phone marked bad',
  cooldown: 'Cooling down until the next round',
  max_rounds: 'Max rounds reached',
};

const money = (n: number | null) => (n == null ? null : `$${Math.round(n / 1000)}k`);

function expiredAgo(date: string | null, now: Date): string | null {
  if (!date) return null;
  const days = Math.floor((now.getTime() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000);
  return days <= 0 ? 'expired today' : `expired ${days}d ago`;
}

const formatClock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export function Dialer(props: {
  queue: FlowLead[];
  settings: SettingsRow;
  batches: ImportBatchRow[];
  dncNumbers: string[];
  vendorDncNumbers: string[];
}) {
  const { settings } = props;
  const [flow, dispatch] = useReducer(flowReducer, props.queue, (queue) => ({ ...initialFlow, queue }));
  const lead = currentLead(flow);
  const phone = currentPhone(flow);
  // Only the next queued lead is warmed, never the whole queue (RealtyAPI credits).
  const nextLeadId = flow.queue[1]?.lead.id ?? null;
  useEffect(() => {
    if (nextLeadId) prefetchCma(nextLeadId);
  }, [nextLeadId]);

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [dropId, setDropId] = useState(settings.voicemail_drops[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [elapsed, setElapsed] = useState(0);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const transcription = useTranscription(activeCall, flow.callId);
  // DNC request detected and its override are tied to the call they happened on.
  const [dncFor, setDncFor] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const dncRequested = flow.callId !== null && dncFor === flow.callId;
  const dncOverridden = flow.callId !== null && overrideFor === flow.callId;
  const flowCallIdRef = useRef(flow.callId);
  useEffect(() => {
    flowCallIdRef.current = flow.callId;
  });
  const onDncRequest = useCallback((cid: string) => {
    if (dncAppliesToCall(cid, flowCallIdRef.current)) setDncFor(cid);
  }, []);
  // Post-call suggestion, tied to the call it was made for; never an auto-save.
  const [suggestion, setSuggestion] = useState<{ callId: string; prefill: Prefill } | null>(null);
  const suggested =
    suggestion && suggestion.callId === flow.callId && suggestion.prefill.outcome && settings.outcomes.includes(suggestion.prefill.outcome)
      ? suggestion.prefill.outcome
      : null;
  const callbackInputRef = useRef<HTMLInputElement | null>(null);
  const finishedFor = useRef<string | null>(null);
  const whenDrained = transcription.whenDrained;
  // Once the call has ended and its transcript tail is saved (4s at most), ask the server for the pre-fill.
  useEffect(() => {
    const callId = flow.callId;
    if (flow.callState !== 'ended' || !callId || finishedFor.current === callId) return;
    finishedFor.current = callId;
    void (async () => {
      await Promise.race([whenDrained(), new Promise((r) => setTimeout(r, 4000))]);
      try {
        const res = await fetch(`/api/calls/${callId}/finish`, { method: 'POST' });
        const body = (await res.json().catch(() => null)) as { prefill?: Prefill | null; dncReview?: boolean } | null;
        if (res.ok && body?.dncReview) {
          setMessage('The post-call check heard a possible DNC request. The lead is held for review on its page.');
        }
        const prefill = body?.prefill;
        if (!res.ok || !prefill || flowCallIdRef.current !== callId) return;
        setSuggestion({ callId, prefill });
        if (prefill.dncSuggested) onDncRequest(callId);
        if (prefill.openCallbackPicker && prefill.outcome === 'callback_requested') {
          // Wait a tick so the picker is mounted before it opens.
          setTimeout(() => {
            const input = callbackInputRef.current;
            if (!input || flowCallIdRef.current !== callId) return;
            input.focus();
            try {
              input.showPicker();
            } catch {
              // showPicker needs a user gesture in some browsers; focus is enough
            }
          }, 0);
        }
      } catch {
        // the dialer works without a suggestion
      }
    })();
  }, [flow.callState, flow.callId, whenDrained, onDncRequest]);

  /** True while a save, voicemail drop or round close is running; a ref so a fast second keypress sees it before any re-render. */
  const busyRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (flow.callState !== 'in_call') return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [flow.callState]);

  useEffect(() => {
    let cancelled = false;
    let device: Device | null = null;
    const fetchToken = async () => {
      const res = await fetch('/api/twilio/token', { cache: 'no-store' });
      const body = (await res.json()) as { ok: boolean; token?: string };
      if (!res.ok || !body.token) throw new Error('token request failed');
      return body.token;
    };
    (async () => {
      try {
        const [Ctor, token] = await Promise.all([loadDeviceCtor(), fetchToken()]);
        if (cancelled) return;
        device = new Ctor(token);
        device.on('error', (error: unknown) => setMessage(`Phone error: ${describeError(error)}`));
        device.on('tokenWillExpire', async () => {
          try {
            device?.updateToken(await fetchToken());
          } catch {
            setMessage('Could not refresh the phone token; reload the page.');
          }
        });
        deviceRef.current = device;
        setDeviceStatus('ready');
      } catch {
        if (!cancelled) setDeviceStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      deviceRef.current = null;
      device?.destroy();
    };
  }, []);

  const block = useMemo(() => {
    if (!lead || !phone) return null;
    const decision = checkDial({
      lead: lead.lead,
      phone,
      batch: props.batches.find((b) => b.id === phone.batch_id) ?? null,
      internalDnc: props.dncNumbers.includes(phone.number),
      vendorDncElsewhere: props.vendorDncNumbers.includes(phone.number),
      settings,
      now,
    });
    return decision.ok ? null : decision.reason;
  }, [lead, phone, props.batches, props.dncNumbers, props.vendorDncNumbers, settings, now]);

  /** Bumped on every dial, so a call id found late for an earlier attempt is never attached to a later one. */
  const attemptRef = useRef(0);

  const dial = useCallback(async () => {
    const device = deviceRef.current;
    if (!device || !lead || !phone || !canDial(flow)) return;
    setMessage(null);
    dispatch({ type: 'dial' });
    const attempt = ++attemptRef.current;
    try {
      const call = await device.connect({ params: { To: phone.number, LeadId: lead.lead.id, PhoneId: phone.id } });
      callRef.current = call;
      const current = () => callRef.current === call;
      // Without a call id no outcome (DNC included) can be saved, so keep looking for as
      // long as the call is live, then once more after it ends.
      let knownCallId: string | null = null;
      const findCallId = async () => {
        const sid = call.parameters.CallSid;
        if (!sid) return null;
        try {
          return await lookupCallId(sid);
        } catch {
          return null;
        }
      };
      const found = (callId: string) => {
        knownCallId = callId;
        if (attemptRef.current === attempt) dispatch({ type: 'call_id', callId });
      };
      call.on('accept', async () => {
        if (!current()) return;
        dispatch({ type: 'accepted' });
        setActiveCall(call);
        while (current() && !knownCallId) {
          const callId = await findCallId();
          if (callId) return found(callId);
          await new Promise((r) => setTimeout(r, 1000));
        }
      });
      const ended = () => {
        if (!current()) return;
        callRef.current = null;
        setActiveCall(null);
        dispatch({ type: 'disconnected' });
        if (!knownCallId) {
          void findCallId().then((callId) => {
            if (callId && !knownCallId) found(callId);
          });
        }
      };
      call.on('disconnect', ended);
      call.on('cancel', ended);
      call.on('reject', ended);
      call.on('error', (error: unknown) => {
        setMessage(`Call error: ${describeError(error)}`);
        ended();
      });
    } catch (error) {
      setMessage(`Could not place the call: ${describeError(error)}`);
      dispatch({ type: 'disconnected' });
    }
  }, [flow, lead, phone]);

  const hangUp = useCallback(() => callRef.current?.disconnect(), []);

  /** Runs `task` unless another save/skip is already in flight. */
  const exclusive = useCallback(async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }, []);

  /** True (with a message) when a DNC request is unresolved and `outcome` is not DNC. */
  const dncGated = useCallback(
    (outcome: string) => {
      if (!dncRequested || dncOverridden || outcome === 'dnc') return false;
      setMessage('The owner asked not to be called. Mark DNC, or click Override to save another outcome.');
      return true;
    },
    [dncRequested, dncOverridden],
  );

  const persist = useCallback(
    async (outcome: string): Promise<boolean> => {
      if (!canSaveOutcome(flow) || !flow.callId) return false;
      if (dncGated(outcome)) return false;
      let callbackIso: string | undefined;
      if (outcome === 'callback_requested') {
        const when = callbackAt ? new Date(callbackAt) : null;
        if (!when || Number.isNaN(when.getTime())) {
          setMessage('Pick a callback time first.');
          return false;
        }
        callbackIso = when.toISOString();
      }
      setMessage(null);
      callRef.current?.disconnect();
      try {
        // Saving is idempotent per call, so a retry after a lost response is safe.
        const result = await saveOutcome(flow.callId, outcome, note, callbackIso);
        if (!result.ok) {
          setMessage(result.error);
          return false;
        }
        callRef.current = null;
        setActiveCall(null);
        // The server left the visit open (next_phone) but no phone is left here: close the round.
        const leadToClose = savedLeavesRoundOpen(flow, result.advance) ? currentLead(flow)?.lead.id : undefined;
        dispatch({ type: 'saved', advance: result.advance });
        if (leadToClose) {
          const closed = await closeRound(leadToClose).catch(() => ({ ok: false, error: undefined }));
          if (!closed.ok) setMessage(closed.error ?? 'Could not close the round for the last lead.');
        }
        setNote('');
        setCallbackAt('');
        return true;
      } catch {
        setMessage('Could not save the outcome. Press it again to retry.');
        return false;
      }
    },
    [flow, note, callbackAt, dncGated],
  );

  const submit = useCallback((outcome: string) => exclusive(async () => void (await persist(outcome))), [exclusive, persist]);

  const dropVoicemail = useCallback(
    () =>
      exclusive(async () => {
        if (!flow.callId || !dropId) return;
        if (dncGated('left_vm')) return; // before the drop plays, not after
        setMessage(null);
        try {
          const res = await fetch('/api/twilio/vm-drop', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ callId: flow.callId, dropId }),
          });
          const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!res.ok || !body?.ok) {
            setMessage(body?.error ?? 'Voicemail drop failed.');
            return;
          }
        } catch {
          setMessage('Voicemail drop failed.');
          return;
        }
        await persist('left_vm');
      }),
    [exclusive, flow.callId, dropId, persist, dncGated],
  );

  const skip = useCallback(
    () =>
      exclusive(async () => {
        if (!canSkip(flow)) return;
        setMessage(null);
        const lead = currentLead(flow);
        if (lead) {
          // The server closes the round only if a visit is open for this lead.
          try {
            const result = await closeRound(lead.lead.id);
            if (!result.ok) {
              setMessage(result.error ?? 'Could not close the round. Try again.');
              return;
            }
          } catch {
            setMessage('Could not close the round. Try again.');
            return;
          }
        }
        dispatch({ type: 'skip' });
      }),
    [exclusive, flow],
  );

  /**
   * DNC for the whole lead. With a call id this is the normal DNC outcome; without one
   * (the id never arrived) the lead is marked DNC directly, with the same effects.
   */
  const markDnc = useCallback(
    () =>
      exclusive(async () => {
        const current = currentLead(flow);
        if (!current) return;
        if (canSaveOutcome(flow)) return void (await persist('dnc'));
        setMessage(null);
        callRef.current?.disconnect();
        try {
          const result = await markLeadDnc(current.lead.id);
          if (!result.ok) return setMessage(result.error);
        } catch {
          return setMessage('Could not mark the lead DNC. Try again.');
        }
        callRef.current = null;
        setActiveCall(null);
        dispatch({ type: 'lead_closed' });
      }),
    [exclusive, flow, persist],
  );

  const submitRef = useRef(submit);
  const skipRef = useRef(skip);
  useEffect(() => {
    submitRef.current = submit;
    skipRef.current = skip;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key.toLowerCase() === 'n') {
        skipRef.current();
        return;
      }
      const index = Number(e.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < PRIMARY_OUTCOMES.length) {
        const outcome = PRIMARY_OUTCOMES[index];
        if (settings.outcomes.includes(outcome)) void submitRef.current(outcome);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.outcomes]);

  const outcomeButtonsEnabled = canSaveOutcome(flow) && !pending;
  const more = settings.outcomes.filter((o) => !(PRIMARY_OUTCOMES as readonly string[]).includes(o));
  const btn = 'rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-baseline justify-between border-b border-neutral-200 pb-2">
        <h1 className="text-xl font-semibold">Dialer</h1>
        <span className="text-sm text-neutral-600" data-testid="queue-count">
          {flow.queue.length} left
        </span>
      </div>

      {deviceStatus === 'error' && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          The phone could not start. Reload the page.
        </p>
      )}

      {!lead ? (
        <p className="py-8 text-center text-neutral-600">Queue empty. Nothing left to call right now.</p>
      ) : (
        <section className="space-y-3 rounded border border-neutral-300 p-4">
          <div>
            <h2 className="text-lg font-semibold">
              {lead.lead.property_address ?? 'Unknown address'} {lead.lead.property_zip ?? ''}
              <span className="font-normal text-neutral-600"> · {lead.lead.owner_full_name ?? 'Unknown owner'}</span>
            </h2>
            <p className="text-sm text-neutral-600">
              {[
                expiredAgo(lead.lead.expired_date, now),
                lead.lead.list_price != null ? `Listed ${money(lead.lead.list_price)}` : null,
                lead.lead.days_on_market != null ? `${lead.lead.days_on_market} DOM` : null,
                lead.lead.price_cuts ? `${lead.lead.price_cuts} price cuts` : null,
                lead.lead.listing_office ? `agent: ${lead.lead.listing_office}` : null,
                lead.lead.attempt_rounds > 0 ? `round ${lead.lead.attempt_rounds + 1}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          <ul className="space-y-1" data-testid="phones">
            {lead.phones.length === 0 && <li className="text-sm text-neutral-600">No dialable phones.</li>}
            {lead.phones.map((p, i) => {
              const active = i === flow.phoneIndex;
              const state = !active
                ? i < flow.phoneIndex ? 'tried' : 'next'
                : flow.callState === 'dialing' ? 'dialing...'
                : flow.callState === 'in_call' ? `in call ${formatClock(elapsed)}`
                : flow.callState === 'ended' ? 'call ended'
                : 'ready';
              return (
                <li key={p.id} className={`flex items-center gap-3 text-sm ${active ? 'font-medium' : 'text-neutral-500'}`}>
                  <span>{active ? '▸' : ' '}</span>
                  <span className="tabular-nums">{p.number}</span>
                  <span className="text-neutral-500">{p.line_type ?? ''}</span>
                  <span>{state}</span>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            {flow.callState === 'dialing' || flow.callState === 'in_call' ? (
              <button type="button" className={btn} onClick={hangUp}>Hang up</button>
            ) : (
              <button
                type="button"
                className={`${btn} bg-neutral-900 text-white hover:bg-neutral-700`}
                disabled={deviceStatus !== 'ready' || !canDial(flow) || block !== null}
                onClick={() => void dial()}
              >
                Call
              </button>
            )}
            {block && (
              <span className="rounded bg-amber-100 px-2 py-1 text-sm text-amber-900" data-testid="block-reason">
                Blocked: {BLOCK_TEXT[block]}
              </span>
            )}
            {flow.callState === 'ended' && !flow.callId && (
              <span className="text-sm text-neutral-600">No call was logged. Press N to skip this lead.</span>
            )}
            <button type="button" className={`${btn} ml-auto`} disabled={pending} onClick={() => void markDnc()}>
              Mark lead DNC
            </button>
          </div>
        </section>
      )}

      {lead && (
        <CmaPanel leadId={lead.lead.id} listPrice={lead.lead.list_price} daysOnMarket={lead.lead.days_on_market} />
      )}

      {lead && dncRequested && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <span className="font-medium">Owner asked not to be called — mark Do Not Call?</span>
          <button
            type="button"
            className={`${btn} bg-red-700 text-white hover:bg-red-800`}
            disabled={!outcomeButtonsEnabled}
            onClick={() => void submit('dnc')}
          >
            Mark DNC
          </button>
          {!dncOverridden && (
            <button type="button" className={btn} onClick={() => setOverrideFor(flow.callId)}>
              Override
            </button>
          )}
        </div>
      )}

      {lead && flow.callState === 'in_call' && (
        <CoachPanel
          callId={flow.callId}
          leadId={lead.lead.id}
          onOwnerTurn={transcription.onOwnerTurn}
          onDncRequest={onDncRequest}
        />
      )}

      {lead && (flow.callState === 'in_call' || flow.callState === 'ended') && (
        <section className="space-y-2 rounded border border-neutral-300 p-4" aria-label="Live transcript">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Transcript</h2>
            {transcription.status === 'paused' && (
              <span className="text-xs text-amber-800">transcription paused</span>
            )}
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm" data-testid="transcript">
            {transcription.segments.length === 0 && <li className="text-neutral-500">Listening...</li>}
            {transcription.segments.map((s, i) => (
              <li key={i} className={s.final ? '' : 'text-neutral-400'}>
                <span className="mr-2 font-medium">{s.speaker === 'rep' ? 'Rep' : 'Owner'}</span>
                {s.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {lead && (
        <section className="space-y-3 rounded border border-neutral-300 p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Outcome">
            {PRIMARY_OUTCOMES.filter((o) => settings.outcomes.includes(o)).map((o) => (
              <button
                key={o}
                type="button"
                className={
                  dncRequested && !dncOverridden && o === 'dnc'
                    ? `${btn} border-red-600 bg-red-50 ring-1 ring-red-600`
                    : suggested === o
                      ? `${btn} border-neutral-900 ring-1 ring-neutral-900`
                      : btn
                }
                disabled={!outcomeButtonsEnabled}
                aria-keyshortcuts={String(PRIMARY_OUTCOMES.indexOf(o) + 1)}
                onClick={() => void submit(o)}
              >
                {outcomeLabel(o)} <kbd className="ml-1 text-xs text-neutral-500">{PRIMARY_OUTCOMES.indexOf(o) + 1}</kbd>
              </button>
            ))}
            {more.length > 0 && (
              <details className="relative">
                <summary className={`${btn} cursor-pointer list-none`}>More</summary>
                <div className="absolute z-10 mt-1 flex min-w-48 flex-col rounded border border-neutral-300 bg-white p-1 shadow">
                  {more.map((o) => (
                    <button
                      key={o}
                      type="button"
                      className="rounded px-3 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-40"
                      disabled={!outcomeButtonsEnabled}
                      onClick={() => void submit(o)}
                    >
                      {outcomeLabel(o)}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>

          {suggested && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-700" data-testid="suggested-outcome">
              Suggested from the transcript: <span className="font-medium">{outcomeLabel(suggested)}</span>
              <button type="button" className={btn} disabled={!outcomeButtonsEnabled} onClick={() => void submit(suggested)}>
                Save {outcomeLabel(suggested)}
              </button>
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Note
              <input
                className="rounded border border-neutral-300 px-2 py-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Callback
              <input
                ref={callbackInputRef}
                type="datetime-local"
                className="rounded border border-neutral-300 px-2 py-1"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
              />
            </label>
            {settings.voicemail_drops.length > 0 && (
              <div className="flex items-end gap-2">
                {settings.voicemail_drops.length > 1 && (
                  <select
                    aria-label="Voicemail message"
                    className="rounded border border-neutral-300 px-2 py-2 text-sm"
                    value={dropId}
                    onChange={(e) => setDropId(e.target.value)}
                  >
                    {settings.voicemail_drops.map((d) => (
                      <option key={d.id} value={d.id}>{d.label}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className={btn}
                  disabled={flow.callState !== 'in_call' || !flow.callId || pending}
                  onClick={() => void dropVoicemail()}
                >
                  Drop voicemail
                </button>
              </div>
            )}
            <button type="button" className={btn} disabled={!canSkip(flow)} onClick={() => void skip()}>
              Next lead <kbd className="ml-1 text-xs text-neutral-500">N</kbd>
            </button>
          </div>

          {message && (
            <p role="alert" className="text-sm text-red-700">{message}</p>
          )}
        </section>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Call } from '@twilio/voice-sdk';
import { createDownsampler, floatToPcm16 } from '@/lib/audio/pcm16';
import { buildOwnerTurn, type OwnerTurn, type Segment } from '@/lib/transcript';
import { createOutbox } from '@/lib/transcript-outbox';

export type { OwnerTurn, Segment };
export type TranscriptionStatus = 'idle' | 'live' | 'paused';

const LISTEN_URL =
  'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1' +
  '&interim_results=true&utterance_end_ms=1000&vad_events=true&smart_format=true';
const FLUSH_MS = 2000;
const CLOSE_WAIT_MS = 1500;

type Speaker = 'rep' | 'owner';
type ChannelState = 'connecting' | 'open' | 'paused';

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/deepgram/token', { method: 'POST', cache: 'no-store' });
  const body = (await res.json()) as { accessToken?: string };
  if (!res.ok || !body.accessToken) throw new Error('token request failed');
  return body.accessToken;
}

/**
 * Live dual-stream transcription of an active Twilio call: the local stream is
 * the rep, the remote stream is the owner. Every failure stays inside this hook;
 * the call itself is never touched.
 */
export function useTranscription(call: Call | null, callId: string | null = null) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const ownerTurnCb = useRef<((turn: OwnerTurn) => void) | null>(null);
  const callIdRef = useRef(callId);
  useEffect(() => {
    callIdRef.current = callId;
  });

  const onOwnerTurn = useCallback((cb: (turn: OwnerTurn) => void) => {
    ownerTurnCb.current = cb;
  }, []);

  useEffect(() => {
    if (!call) return;

    let closed = false;
    const acceptedAt = performance.now();
    const finals: Segment[] = [];
    const interim: Partial<Record<Speaker, Segment>> = {};
    const outbox = createOutbox(async (id, batch) => {
      try {
        const res = await fetch(`/api/calls/${id}/segments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ segments: batch }),
          keepalive: true,
        });
        return res.ok;
      } catch {
        return false;
      }
    });
    // The session is bound to its own call id: the last one seen while open, frozen at cleanup.
    let boundId: string | null = null;
    const sessionCallId = () => {
      if (!closed && callIdRef.current) boundId = callIdRef.current;
      return boundId;
    };
    const channelState: Partial<Record<Speaker, ChannelState>> = {};
    const sockets = new Set<WebSocket>();
    let turnId = 0;
    let ctx: AudioContext | null = null;

    const publish = () => setSegments([...finals, ...Object.values(interim).filter((s): s is Segment => !!s)]);

    const recomputeStatus = () => {
      const states = Object.values(channelState);
      if (states.includes('paused')) setStatus('paused');
      else if (states.includes('open')) setStatus('live');
    };

    const flushTimer = setInterval(() => void outbox.flush(sessionCallId()), FLUSH_MS);

    const handleResult = (speaker: Speaker, offset: number, msg: unknown) => {
      const m = msg as {
        type?: string;
        is_final?: boolean;
        speech_final?: boolean;
        start?: number;
        duration?: number;
        channel?: { alternatives?: { transcript?: string }[] };
      };
      if (m.type !== 'Results') return;
      const text = (m.channel?.alternatives?.[0]?.transcript ?? '').trim();
      const tStart = offset + (m.start ?? 0);
      const tEnd = tStart + (m.duration ?? 0);
      if (!text) {
        if (!closed && interim[speaker]) {
          delete interim[speaker];
          publish();
        }
        return;
      }
      if (!m.is_final) {
        if (closed) return;
        interim[speaker] = { speaker, text, tStart, tEnd, final: false };
        publish();
        return;
      }
      outbox.push({ speaker, text: text.slice(0, 2000), tStart, tEnd });
      // After the call ends, late finals are still saved to this call but never shown or coached on.
      if (closed) return;
      delete interim[speaker];
      finals.push({ speaker, text, tStart, tEnd, final: true });
      publish();
      if (speaker === 'owner' && m.speech_final) {
        try {
          ownerTurnCb.current?.(buildOwnerTurn(finals, turnId++));
        } catch {
          // a coaching callback must never break transcription
        }
      }
    };

    const openChannel = (speaker: Speaker, stream: MediaStream, audioCtx: AudioContext, node: AudioWorkletNode) => {
      const downsample = createDownsampler(audioCtx.sampleRate, 16000);
      let socket: WebSocket | null = null;
      channelState[speaker] = 'connecting';

      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (socket?.readyState !== WebSocket.OPEN) return;
        const pcm = floatToPcm16(downsample(e.data));
        if (pcm.length) socket.send(pcm.buffer);
      };
      audioCtx.createMediaStreamSource(stream).connect(node);
      node.connect(audioCtx.destination); // renders silence; keeps the node pulled by the graph

      const connect = async (attempt: number) => {
        if (closed) return;
        let token: string;
        try {
          token = await fetchToken();
        } catch {
          channelState[speaker] = 'paused';
          recomputeStatus();
          return;
        }
        if (closed) return;
        const ws = new WebSocket(LISTEN_URL, ['bearer', token]);
        sockets.add(ws);
        let offset = 0;
        ws.onopen = () => {
          offset = (performance.now() - acceptedAt) / 1000;
          socket = ws;
          channelState[speaker] = 'open';
          recomputeStatus();
        };
        ws.onmessage = (e) => {
          try {
            handleResult(speaker, offset, JSON.parse(e.data as string));
          } catch {
            // ignore malformed frames
          }
        };
        ws.onerror = () => {}; // onclose always follows and handles recovery
        ws.onclose = () => {
          sockets.delete(ws);
          if (socket === ws) socket = null;
          if (closed) return;
          if (attempt === 0) void connect(1);
          else {
            channelState[speaker] = 'paused';
            recomputeStatus();
          }
        };
      };
      void connect(0);
    };

    (async () => {
      setSegments([]);
      setStatus('idle');
      try {
        const local = call.getLocalStream?.();
        const remote = call.getRemoteStream?.();
        if (!local && !remote) throw new Error('no call audio streams');
        ctx = new AudioContext();
        await ctx.audioWorklet.addModule('/pcm16-worklet.js');
        if (closed) return;
        await ctx.resume();
        if (local) openChannel('rep', local, ctx, new AudioWorkletNode(ctx, 'pcm-capture'));
        if (remote) openChannel('owner', remote, ctx, new AudioWorkletNode(ctx, 'pcm-capture'));
      } catch {
        if (!closed) setStatus('paused');
      }
    })();

    return () => {
      const finalId = sessionCallId();
      closed = true;
      clearInterval(flushTimer);
      const audioCtx = ctx;
      ctx = null;
      void audioCtx?.close().catch(() => {});
      for (const ws of sockets) {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
        } catch {
          // already closing
        }
      }
      // Let Deepgram finish pending audio, then drop the sockets and save the tail.
      setTimeout(() => {
        for (const ws of sockets) ws.close();
        sockets.clear();
        void outbox.drain(finalId);
      }, CLOSE_WAIT_MS);
    };
  }, [call]);

  return { segments, status: call ? status : ('idle' as TranscriptionStatus), onOwnerTurn };
}

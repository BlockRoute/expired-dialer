'use client';

import { useRef, useState, useTransition } from 'react';
import { encodeWav, mixToMono } from '@/lib/audio/wav';
import type { VoicemailDrop } from '@/lib/db/types';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { addVoicemailDrop, deleteVoicemailDrop } from './actions';

const MAX_DROPS = 3;
const WAV_RATE = 16000;
const input = 'rounded border border-neutral-300 px-2 py-1 text-sm';

/** Decodes the recorded webm/ogg and re-encodes it as 16-bit mono WAV, which Twilio <Play> can play. */
async function toWav(blob: Blob): Promise<Uint8Array> {
  const ctx = new AudioContext({ sampleRate: WAV_RATE });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    return encodeWav(mixToMono(channels), buf.sampleRate);
  } finally {
    await ctx.close();
  }
}

export function VoicemailDrops({ drops }: { drops: VoicemailDrop[] }) {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const begin = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const b = new Blob(chunks.current, { type: rec.mimeType });
        setBlob(b);
        setPreviewUrl(URL.createObjectURL(b));
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError('Could not access the microphone.');
    }
  };

  const stop = () => {
    recorder.current?.stop();
    setRecording(false);
  };

  const discard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setBlob(null);
    setPreviewUrl(null);
    setLabel('');
  };

  const save = async () => {
    if (!blob || !label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const wav = await toWav(blob);
      const id = crypto.randomUUID();
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.storage
        .from('vm-drops')
        .upload(`${id}.wav`, new Blob([wav as BlobPart], { type: 'audio/wav' }), { contentType: 'audio/wav' });
      if (upErr) throw new Error('Upload failed.');
      const r = await addVoicemailDrop({ id, label });
      if (!r.ok) throw new Error(r.error);
      discard();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the recording.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) =>
    start(async () => {
      const r = await deleteVoicemailDrop(id);
      setError(r.ok ? null : r.error);
    });

  return (
    <section className="space-y-2">
      <h2 className="font-medium">
        Voicemail drops ({drops.length}/{MAX_DROPS})
      </h2>
      <ul className="divide-y divide-neutral-200 text-sm">
        {drops.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-1.5">
            <span>{d.label}</span>
            <button onClick={() => remove(d.id)} disabled={pending} className="ml-auto text-red-700 underline">
              Delete
            </button>
          </li>
        ))}
      </ul>
      {drops.length < MAX_DROPS && (
        <div className="space-y-2">
          {!blob && (
            <button onClick={recording ? stop : begin} className="rounded border border-neutral-300 px-3 py-1 text-sm">
              {recording ? 'Stop recording' : 'Record a drop'}
            </button>
          )}
          {blob && previewUrl && (
            <div className="flex flex-wrap items-center gap-2">
              <audio src={previewUrl} controls />
              <input className={input} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
              <button onClick={save} disabled={busy || !label.trim()} className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">
                {busy ? 'Saving...' : 'Save'}
              </button>
              <button onClick={discard} className="text-sm underline">
                Discard
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </section>
  );
}

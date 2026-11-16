import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readTwilioParams } from '@/lib/twilio/params';
import { verifyTwilioRequest } from '@/lib/twilio/signature';

export const dynamic = 'force-dynamic';

/** Twilio recordingStatusCallback: copies the finished mp3 into private storage. */
export async function POST(request: Request) {
  const params = await readTwilioParams(request);
  if (!(await verifyTwilioRequest(request, params))) return new Response(null, { status: 403 });

  const callId = new URL(request.url).searchParams.get('callId');
  if (!callId || params.RecordingStatus !== 'completed' || !params.RecordingUrl) {
    return NextResponse.json({ ok: true });
  }

  try {
    const db = createSupabaseAdminClient();
    const { data: call, error } = await db
      .from('calls')
      .select('id, recording_path')
      .eq('id', callId)
      .maybeSingle();
    if (error) throw new Error('call lookup failed');
    // No RecordingSid column: an existing path is the idempotency marker.
    if (!call || call.recording_path) return NextResponse.json({ ok: true });

    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`${params.RecordingUrl}.mp3`, { headers: { authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`recording download failed (${res.status})`);

    const path = `${call.id}.mp3`;
    const { error: uploadError } = await db.storage
      .from('recordings')
      .upload(path, await res.arrayBuffer(), { contentType: 'audio/mpeg', upsert: true });
    if (uploadError) throw new Error('recording upload failed');

    const { error: updateError } = await db.from('calls').update({ recording_path: path }).eq('id', call.id);
    if (updateError) throw new Error('recording path update failed');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('twilio recording route failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { requireUserApi } from '@/lib/auth';
import type { CallRow, SettingsRow } from '@/lib/db/types';
import { withApiErrors } from '@/lib/server/api-errors';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { twilioRestClient } from '@/lib/twilio/client';
import { playTwiml } from '@/lib/twilio/twiml';

export const dynamic = 'force-dynamic';

const SIGNED_URL_TTL_S = 600;

/** Plays a saved voicemail to the lead, ends the call, and records the outcome. */
export const POST = withApiErrors(async (request) => {
  await requireUserApi();

  const body = (await request.json().catch(() => null)) as { callId?: unknown; dropId?: unknown } | null;
  if (!body || typeof body.callId !== 'string' || typeof body.dropId !== 'string') {
    return NextResponse.json({ ok: false, error: 'callId and dropId are required.' }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const [callRes, settingsRes] = await Promise.all([
    db.from('calls').select('*').eq('id', body.callId).maybeSingle(),
    db.from('settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (callRes.error || settingsRes.error) throw new Error('Database request failed');
  const call = callRes.data as CallRow | null;
  const settings = settingsRes.data as SettingsRow | null;
  if (!call) return NextResponse.json({ ok: false, error: 'Call not found.' }, { status: 404 });

  const drop = settings?.voicemail_drops.find((d) => d.id === body.dropId);
  if (!drop) return NextResponse.json({ ok: false, error: 'Voicemail drop not found.' }, { status: 404 });
  if (!call.twilio_child_sid || !call.twilio_parent_sid) {
    return NextResponse.json({ ok: false, error: 'Call is not connected yet.' }, { status: 409 });
  }

  const { data: signed, error: signError } = await db.storage
    .from('vm-drops')
    .createSignedUrl(drop.path, SIGNED_URL_TTL_S);
  if (signError || !signed) throw new Error('Voicemail drop URL could not be signed');

  const twilio = twilioRestClient();
  await twilio.calls(call.twilio_child_sid).update({ twiml: playTwiml(signed.signedUrl) });
  // The child redirect is the commit point: the lead now hears the voicemail.
  const { error: updateError } = await db
    .from('calls')
    // outcome_saved_at stays null: the dialer's saveOutcome applies the lead effects exactly once.
    .update({ outcome: 'left_vm' })
    .eq('id', call.id);
  if (updateError) throw new Error('Database request failed');

  // Best-effort: the Dial action usually hangs the parent up first, so this may be rejected.
  try {
    await twilio.calls(call.twilio_parent_sid).update({ status: 'completed' });
  } catch (error) {
    console.error('vm-drop parent hangup failed', error instanceof Error ? error.message : 'unknown');
  }

  return NextResponse.json({ ok: true });
});

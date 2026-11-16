import { checkDial } from '@/lib/guardrails';
import { normalizePhone } from '@/lib/phone';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { verifyTwilioRequest } from '@/lib/twilio/signature';
import { dialTwiml, messageTwiml, rejectTwiml } from '@/lib/twilio/twiml';
import type { ImportBatchRow, LeadRow, PhoneRow, SettingsRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

const xml = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/xml; charset=utf-8' } });

/**
 * Twilio calls this when the browser Device connects. It is the server-side
 * authority: every guardrail is re-checked here before any number is dialed.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') params[key] = value;

  if (!verifyTwilioRequest(request, params)) {
    return xml('<Response/>', 403);
  }

  const { To, LeadId, PhoneId, CallSid } = params;
  if (!To || !LeadId || !PhoneId || !CallSid) return xml(messageTwiml('Blocked: missing call details'));

  try {
    const db = createSupabaseAdminClient();
    const [leadRes, phoneRes, settingsRes] = await Promise.all([
      db.from('leads').select('*').eq('id', LeadId).maybeSingle(),
      db.from('phones').select('*').eq('id', PhoneId).maybeSingle(),
      db.from('settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const lead = leadRes.data as LeadRow | null;
    const phone = phoneRes.data as PhoneRow | null;
    const settings = settingsRes.data as SettingsRow | null;
    if (leadRes.error || phoneRes.error || settingsRes.error) throw new Error('lookup failed');
    if (!lead || !phone || phone.lead_id !== lead.id) return xml(messageTwiml('Blocked: unknown lead or phone'));
    if (!settings) return xml(messageTwiml('Blocked: settings are missing'));

    const requested = normalizePhone(To);
    if (!requested || requested !== normalizePhone(phone.number)) {
      return xml(messageTwiml('Blocked: number does not match the lead'));
    }

    const [batchRes, dncRes, vendorDncRes] = await Promise.all([
      phone.batch_id
        ? db.from('import_batches').select('*').eq('id', phone.batch_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from('dnc_numbers').select('number').eq('number', phone.number).maybeSingle(),
      // A vendor do_not_call flag blocks the number on every lead it appears on.
      db.from('phones').select('id').eq('number', phone.number).eq('vendor_dnc', 'do_not_call').limit(1),
    ]);
    if (batchRes.error || dncRes.error || vendorDncRes.error) throw new Error('lookup failed');

    const decision = checkDial({
      lead,
      phone,
      batch: (batchRes.data as ImportBatchRow | null) ?? null,
      internalDnc: !!dncRes.data,
      vendorDncElsewhere: (vendorDncRes.data ?? []).length > 0,
      settings,
      now: new Date(),
    });
    if (!decision.ok) return xml(rejectTwiml(decision.reason));

    const callerId = settings.caller_id || process.env.TWILIO_CALLER_ID;
    if (!callerId) return xml(messageTwiml('Blocked: no caller ID configured'));

    const { data: call, error: insertError } = await db
      .from('calls')
      .insert({
        lead_id: lead.id,
        phone_id: phone.id,
        direction: 'outbound',
        status: 'queued',
        twilio_parent_sid: CallSid,
      })
      .select('id')
      .single();
    if (insertError || !call) throw new Error('call insert failed');

    // Open the lead's visit (once): from here a skip or reload still counts the round.
    const { error: visitError } = await db
      .from('leads')
      .update({ visit_open_at: new Date().toISOString() })
      .eq('id', lead.id)
      .is('visit_open_at', null);
    if (visitError) throw new Error('visit open failed');

    return xml(
      dialTwiml({ to: phone.number, callerId, callId: call.id, ringTimeoutS: settings.ring_timeout_s }),
    );
  } catch (error) {
    console.error('twilio voice route failed', error instanceof Error ? error.message : 'unknown');
    return xml(messageTwiml('Blocked: server error, call not placed'));
  }
}

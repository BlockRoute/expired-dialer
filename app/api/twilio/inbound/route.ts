import { normalizePhone } from '@/lib/phone';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readTwilioParams } from '@/lib/twilio/params';
import { verifyTwilioRequest } from '@/lib/twilio/signature';
import { forwardTwiml, messageTwiml } from '@/lib/twilio/twiml';

export const dynamic = 'force-dynamic';

const xml = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/xml; charset=utf-8' } });

/** Calls to the Twilio number are forwarded to Daniel's cell; logging is best-effort. */
export async function POST(request: Request) {
  const params = await readTwilioParams(request);
  if (!verifyTwilioRequest(request, params)) return xml('<Response/>', 403);

  const cell = process.env.DANIEL_CELL;
  if (!cell) return xml(messageTwiml('This line is not configured to take calls.'));

  const { From, CallSid } = params;
  if (From && CallSid) {
    try {
      const db = createSupabaseAdminClient();
      const normalized = normalizePhone(From);
      let leadId: string | null = null;
      let phoneId: string | null = null;
      if (normalized) {
        const { data } = await db.from('phones').select('id, lead_id').eq('number', normalized).limit(1).maybeSingle();
        leadId = data?.lead_id ?? null;
        phoneId = data?.id ?? null;
      }
      const { error } = await db.from('calls').insert({
        lead_id: leadId,
        phone_id: phoneId,
        direction: 'inbound',
        status: 'ringing',
        twilio_parent_sid: CallSid,
      });
      if (error) throw new Error('inbound call insert failed');
    } catch (error) {
      console.error('twilio inbound log failed', error instanceof Error ? error.message : 'unknown');
    }
  }

  return xml(forwardTwiml({ to: cell, callerId: From || cell }));
}

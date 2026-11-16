import type { CallRow } from '@/lib/db/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readTwilioParams } from '@/lib/twilio/params';
import { verifyTwilioRequest } from '@/lib/twilio/signature';
import { dialCallStatus, nextCallState, twilioCallStatus } from '@/lib/twilio/status';

export const dynamic = 'force-dynamic';

const xml = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/xml; charset=utf-8' } });

/**
 * Two callbacks share this route, told apart by `leg`:
 * - child: the <Number> statusCallback (CallStatus, carries the child CallSid)
 * - dial: the <Dial> action (DialCallStatus); its response is the next TwiML.
 */
export async function POST(request: Request) {
  const params = await readTwilioParams(request);
  if (!(await verifyTwilioRequest(request, params))) return xml('<Response/>', 403);

  const url = new URL(request.url);
  const callId = url.searchParams.get('callId');
  const isDial = url.searchParams.get('leg') === 'dial';
  const reply = () => xml(isDial ? '<Response><Hangup/></Response>' : '<Response/>');

  const status = isDial ? dialCallStatus(params.DialCallStatus) : twilioCallStatus(params.CallStatus);
  if (!callId || !status) return reply();

  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db.from('calls').select('*').eq('id', callId).maybeSingle();
    if (error) throw new Error('call lookup failed');
    const call = data as CallRow | null;
    if (!call) return reply();

    const patch = nextCallState(call, {
      status,
      at: new Date().toISOString(),
      childSid: isDial ? undefined : params.CallSid,
    });
    if (patch) {
      // Guard on the status we read so a racing callback can't move it backwards.
      const { error: updateError } = await db
        .from('calls')
        .update(patch)
        .eq('id', call.id)
        .eq('status', call.status);
      if (updateError) throw new Error('call update failed');
    }
  } catch (error) {
    console.error('twilio status route failed', error instanceof Error ? error.message : 'unknown');
  }
  return reply();
}

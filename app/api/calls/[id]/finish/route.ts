import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { requireUserApi } from '@/lib/auth';
import { withApiErrors } from '@/lib/server/api-errors';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { extractJson, runClaude, usableText } from '@/lib/ai/anthropic';
import { jev } from '@/lib/typesafe/client';
import { appointmentNoul, callbackTimeNoul, dncRequestNoul, outcomeChoice } from '@/lib/typesafe/questions';
import { OUTCOME_CRITERIA, formatCallTranscript, hasOwnerSpeech, prefillFromAnswers } from '@/lib/postcall/prefill';

export const dynamic = 'force-dynamic';

const SUMMARY_MODEL = 'claude-sonnet-5-5';
// Jev (8 s) runs before the response; the one summary attempt (15 s, no retry) runs in
// after(), which OpenNext hands to the Worker's waitUntil (~30 s after the response; see README).
const SUMMARY_TIMEOUT_MS = 15_000;
const JEV_TIMEOUT_MS = 8_000;
const DNC_THRESHOLD = 0.5;

// Byte-stable: the transcript goes in the user message, never here.
const SUMMARY_SYSTEM = [
  'You summarize a cold call a real estate agent (the Rep) made to the owner of an expired home listing.',
  'The transcript is raw speech-to-text and may contain errors. Use only what is in it; never invent facts.',
  'Reply with only a JSON object: {"summary": string, "note": string, "next_step": string}.',
  '"summary" is two to four plain sentences on what happened. "note" is one line the agent can save on the lead.',
  '"next_step" is the single most useful follow-up action, or "None" if the call is finished.',
  'No other text.',
].join('\n');

type Summary = { summary: string; note: string; next_step: string };

async function writeSummary(db: ReturnType<typeof createSupabaseAdminClient>, callId: string, transcript: string) {
  try {
    const message = await runClaude({
      system: SUMMARY_SYSTEM,
      model: SUMMARY_MODEL,
      // Sonnet 5.5 cannot disable thinking; low effort keeps it short, and the budget leaves room for the JSON.
      effort: 'low',
      maxTokens: 4_000,
      requestOptions: { timeout: SUMMARY_TIMEOUT_MS, maxRetries: 0 },
      messages: [{ role: 'user', content: `Call transcript:\n${transcript}` }],
    });
    const text = usableText(message);
    if (!text) {
      console.error('call summary incomplete', callId, message.stop_reason ?? 'no_text');
      return;
    }
    const parsed = extractJson<Partial<Summary>>(text);
    if (!parsed || [parsed.summary, parsed.note, parsed.next_step].some((v) => typeof v !== 'string')) {
      console.error('call summary unparseable', callId);
      return;
    }
    const ai_summary: Summary = {
      summary: parsed.summary!.trim(),
      note: parsed.note!.trim(),
      next_step: parsed.next_step!.trim(),
    };
    const { error } = await db.from('calls').update({ ai_summary }).eq('id', callId).is('ai_summary', null);
    if (error) console.error('call summary save failed', callId, error.code ?? 'unknown');
  } catch (e) {
    console.error('call summary failed', callId, e instanceof Error ? e.name : 'error');
  }
}

type Db = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Spec 8a post-call pass: the full transcript reads as a DNC request the saved outcome
 * is not. Flag the call and hold the lead out of dialing until Daniel reviews it on the
 * lead page. Nothing is added to dnc_numbers here. Returns whether it flagged.
 */
async function flagDncReview(db: Db, call: { id: string; lead_id: string | null; outcome: string | null }, dncP: number) {
  if (!(dncP >= DNC_THRESHOLD) || call.outcome === 'dnc' || !call.lead_id) return false;
  const [callUpd, leadUpd] = await Promise.all([
    db.from('calls').update({ dnc_suspected: true }).eq('id', call.id),
    db
      .from('leads')
      .update({ dnc_review_at: new Date().toISOString() })
      .eq('id', call.lead_id)
      .is('dnc_review_at', null)
      .neq('status', 'dnc'),
  ]);
  if (callUpd.error || leadUpd.error) {
    console.error('dnc review flag failed', call.id, (callUpd.error ?? leadUpd.error)?.code ?? 'unknown');
  }
  return true;
}

/**
 * Post-call: the DNC re-check (always, when the owner spoke), the outcome pre-fill from
 * Jev (only while no outcome is saved), and the Claude summary (written after the response).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrors(async () => {
    await requireUserApi();
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: 'Call not found.' }, { status: 404 });

    const db = createSupabaseAdminClient();
    const [callRes, segRes, settingsRes] = await Promise.all([
      db.from('calls').select('id, lead_id, ai_summary, outcome, outcome_saved_at').eq('id', id).maybeSingle(),
      db.from('transcript_segments').select('speaker, text, t_start').eq('call_id', id).order('t_start', { ascending: true }),
      db.from('settings').select('outcomes').eq('id', 1).maybeSingle(),
    ]);
    if (callRes.error || segRes.error) throw new Error('Database request failed');
    const call = callRes.data as
      | { id: string; lead_id: string | null; ai_summary: unknown; outcome: string | null; outcome_saved_at: string | null }
      | null;
    if (!call) return NextResponse.json({ ok: false, error: 'Call not found.' }, { status: 404 });

    const rows = (segRes.data ?? []) as { speaker: 'rep' | 'owner'; text: string; t_start: number | null }[];
    if (!hasOwnerSpeech(rows)) return NextResponse.json({ prefill: null });
    const transcript = formatCallTranscript(rows);

    if (!call.ai_summary) after(() => writeSummary(db, id, transcript));

    const review = (flagged: boolean) => (flagged ? { dncReview: true } : {});

    // A saved outcome is final; the suggestion never replaces it. The DNC re-check still runs.
    if (call.outcome_saved_at) {
      try {
        const answers = await jev({ transcript }, { dnc: dncRequestNoul('transcript') }, { timeoutMs: JEV_TIMEOUT_MS });
        const dnc = answers.dnc;
        const flagged = dnc?.type === 'noul' ? await flagDncReview(db, { ...call, id }, dnc.noul) : false;
        return NextResponse.json({ prefill: null, ...review(flagged) });
      } catch (e) {
        console.error('post-call dnc check failed', id, e instanceof Error ? e.name : 'error');
        return NextResponse.json({ prefill: null });
      }
    }

    const enabled = (settingsRes.data as { outcomes?: string[] } | null)?.outcomes;
    const criteria = Object.fromEntries(
      Object.entries(OUTCOME_CRITERIA).filter(([key]) => !enabled || enabled.includes(key)),
    );
    try {
      const answers = await jev(
        { transcript },
        {
          outcome: outcomeChoice(criteria),
          appointment: appointmentNoul(),
          callback_time: callbackTimeNoul(),
          dnc: dncRequestNoul('transcript'),
        },
        { timeoutMs: JEV_TIMEOUT_MS },
      );
      const dnc = answers.dnc;
      const flagged = dnc?.type === 'noul' ? await flagDncReview(db, { ...call, id }, dnc.noul) : false;
      return NextResponse.json({ prefill: prefillFromAnswers(answers, enabled), ...review(flagged) });
    } catch (e) {
      console.error('post-call prefill failed', id, e instanceof Error ? e.name : 'error');
      return NextResponse.json({ prefill: null });
    }
  })(request);
}

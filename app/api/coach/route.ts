import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserApi } from '@/lib/auth';
import { withApiErrors } from '@/lib/server/api-errors';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { extractJson, extractText, runClaude } from '@/lib/ai/anthropic';
import { jev, type JevAnswers } from '@/lib/typesafe/client';
import { cardChoice, dncRequestNoul } from '@/lib/typesafe/questions';
import { decideCards } from '@/lib/coach/decide';
import { renderSay } from '@/lib/coach/render';
import type { LeadRow, PlaybookCardRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

const FALLBACK_MODEL = 'claude-haiku-5-5';
const MAX_SAY_WORDS = 20;
const FALLBACK_TIMEOUT_MS = 2500;

const bodySchema = z.object({
  callId: z.uuid(),
  leadId: z.uuid(),
  turn: z.object({
    ownerSaid: z.string().min(1).max(4000),
    transcriptSoFar: z.string().max(20000),
    turnId: z.number().int(),
  }),
});

type CoachCard = { key: string; title: string; say: string; why?: string; source: 'jev' | 'claude' };

// Byte-stable: lead and call data go in the user message, never here.
const FALLBACK_SYSTEM = [
  'You help a real estate agent who is cold-calling the owner of an expired home listing.',
  'The owner just said something that none of the agent\'s prepared response cards fit.',
  'Write one short card the agent can glance at and say aloud.',
  'Reply with only a JSON object: {"title": string, "say": string, "why": string}.',
  '"title" is at most 6 words. "say" is what the agent says next, plain and conversational, at most 20 words.',
  '"why" is one short sentence on the goal of the reply. No other text.',
].join('\n');

const truncateWords = (s: string, n: number) => s.trim().split(/\s+/).filter(Boolean).slice(0, n).join(' ');

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function claudeCard(ownerSaid: string, transcriptSoFar: string, firstName: string | null): Promise<CoachCard | null> {
  try {
    const message = await runClaude({
      system: FALLBACK_SYSTEM,
      model: FALLBACK_MODEL,
      maxTokens: 200,
      requestOptions: { timeout: FALLBACK_TIMEOUT_MS, maxRetries: 0 },
      messages: [
        {
          role: 'user',
          content: `Owner first name: ${firstName ?? 'unknown'}\nConversation so far:\n${transcriptSoFar || '(none)'}\n\nOwner just said: ${ownerSaid}`,
        },
      ],
    });
    const parsed = extractJson<{ title?: unknown; say?: unknown; why?: unknown }>(extractText(message));
    if (!parsed || typeof parsed.say !== 'string' || typeof parsed.title !== 'string') return null;
    const say = truncateWords(parsed.say, MAX_SAY_WORDS);
    const title = truncateWords(parsed.title, 8);
    if (!say || !title) return null;
    return { key: 'ai_written', title, say, why: typeof parsed.why === 'string' ? parsed.why.slice(0, 200) : undefined, source: 'claude' };
  } catch {
    return null;
  }
}

export const POST = withApiErrors(async (request) => {
  await requireUserApi();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid coaching request.' }, { status: 400 });
  const { callId, leadId, turn } = parsed.data;

  const paused = () => NextResponse.json({ turnId: turn.turnId, cards: [], dncP: null, paused: true, coachCardId: null });
  const started = Date.now();

  try {
    const db = createSupabaseAdminClient();
    const [callRes, playbookRes, leadRes, cmaRes] = await Promise.all([
      db.from('calls').select('lead_id').eq('id', callId).maybeSingle(),
      db.from('playbook_cards').select('*').eq('active', true).order('sort', { ascending: true }),
      db.from('leads').select('*').eq('id', leadId).maybeSingle(),
      db
        .from('cmas')
        .select('price_range')
        .eq('lead_id', leadId)
        .not('price_range', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (callRes.error || playbookRes.error || leadRes.error) return paused();
    if ((callRes.data as { lead_id: string | null } | null)?.lead_id !== leadId) return paused();
    const playbook = (playbookRes.data ?? []) as PlaybookCardRow[];
    const lead = (leadRes.data ?? {}) as Partial<LeadRow>;
    const range = (cmaRes.data as { price_range?: { low?: unknown; high?: unknown } } | null)?.price_range;
    const cma =
      range && typeof range.low === 'number' && typeof range.high === 'number' ? { low: range.low, high: range.high } : null;

    const answers: JevAnswers = await jev(
      {
        call_context: 'Real estate agent cold-calling the owner of a recently expired home listing in Virginia.' +
          (turn.transcriptSoFar ? ' Transcript is raw speech-to-text.' : ''),
        ...(turn.transcriptSoFar ? { transcript_so_far: turn.transcriptSoFar } : {}),
        owner_said: turn.ownerSaid,
      },
      { card: cardChoice(playbook, !!turn.transcriptSoFar), dnc: dncRequestNoul('owner_said') },
    );
    const cardAnswer = answers.card;
    const dncAnswer = answers.dnc;
    if (cardAnswer?.type !== 'choice' || dncAnswer?.type !== 'noul') return paused();
    const dncP = dncAnswer.noul;

    const decision = decideCards(cardAnswer, turn.ownerSaid);
    let cards: CoachCard[] = [];
    let source: 'jev' | 'claude' = 'jev';
    if (decision.mode === 'single' || decision.mode === 'pair') {
      cards = decision.keys.flatMap((key) => {
        const row = playbook.find((c) => c.key === key);
        if (!row) return [];
        return [
          {
            key,
            title: row.title,
            say: renderSay(row.say ?? '', lead, cma),
            ...(row.why ? { why: row.why } : {}),
            source: 'jev' as const,
          },
        ];
      });
    } else if (decision.mode === 'fallback') {
      const card = await withTimeout(
        claudeCard(turn.ownerSaid, turn.transcriptSoFar, lead.owner_first_name ?? null),
        FALLBACK_TIMEOUT_MS + 500,
      );
      if (card) {
        cards = [card];
        source = 'claude';
      } else {
        // The fallback failed or timed out: keep this turn's DNC signal, show "coaching paused".
        return NextResponse.json({ turnId: turn.turnId, cards: [], dncP, paused: true, coachCardId: null });
      }
    }

    const latencyMs = Date.now() - started;
    let coachCardId: string | null = null;
    if (cards.length > 0) {
      const second = cards[1] ? cardAnswer.probabilities[cards[1].key] ?? null : null;
      const { data, error: insertError } = await db
        .from('coach_cards')
        .insert({
          call_id: callId,
          source,
          card_key: cards[0].key,
          confidence: source === 'jev' ? cardAnswer.confidence : null,
          runner_up_key: cards[1]?.key ?? null,
          runner_up_probability: second,
          dnc_p: dncP,
          latency_ms: latencyMs,
        })
        .select('id')
        .single();
      if (insertError) console.error('coach_cards insert failed', insertError.code ?? 'unknown');
      coachCardId = (data as { id: string } | null)?.id ?? null;
    }

    return NextResponse.json({ turnId: turn.turnId, cards, dncP, latencyMs, coachCardId });
  } catch {
    return paused();
  }
});

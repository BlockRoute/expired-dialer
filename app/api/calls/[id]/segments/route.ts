import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserApi } from '@/lib/auth';
import { withApiErrors } from '@/lib/server/api-errors';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  segments: z
    .array(
      z.object({
        speaker: z.enum(['rep', 'owner']),
        text: z.string().min(1).max(2000),
        tStart: z.number().finite(),
        tEnd: z.number().finite(),
      }),
    )
    .min(1)
    .max(100),
});

/** Appends final transcript segments to a call. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrors(async (req) => {
    await requireUserApi();
    const { id } = await ctx.params;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid segments.' }, { status: 400 });
    }
    if (!z.uuid().safeParse(id).success) {
      return NextResponse.json({ ok: false, error: 'Call not found.' }, { status: 404 });
    }

    const db = createSupabaseAdminClient();
    const { data: call, error: callError } = await db.from('calls').select('id').eq('id', id).maybeSingle();
    if (callError) throw new Error('Database request failed');
    if (!call) return NextResponse.json({ ok: false, error: 'Call not found.' }, { status: 404 });

    const { error } = await db.from('transcript_segments').insert(
      parsed.data.segments.map((s) => ({
        call_id: id,
        speaker: s.speaker,
        text: s.text,
        t_start: s.tStart,
        t_end: s.tEnd,
      })),
    );
    if (error) throw new Error('Database request failed');
    return NextResponse.json({ ok: true, inserted: parsed.data.segments.length });
  })(request);
}

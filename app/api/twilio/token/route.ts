import { NextResponse } from 'next/server';
import { requireUserApi } from '@/lib/auth';
import { withApiErrors } from '@/lib/server/api-errors';
import { voiceToken } from '@/lib/twilio/client';

export const dynamic = 'force-dynamic';

export const GET = withApiErrors(async () => {
  await requireUserApi();
  return NextResponse.json(
    { ok: true, token: voiceToken('daniel') },
    { headers: { 'cache-control': 'no-store' } },
  );
});

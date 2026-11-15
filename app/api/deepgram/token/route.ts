import { NextResponse } from 'next/server';
import { requireUserApi } from '@/lib/auth';
import { withApiErrors } from '@/lib/server/api-errors';

export const dynamic = 'force-dynamic';

const TOKEN_TTL_S = 60;

/** Mints a short-lived Deepgram token so the browser never sees the API key. */
export const POST = withApiErrors(async () => {
  await requireUserApi();
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set');

  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: TOKEN_TTL_S }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
  if (!res.ok || !body?.access_token) throw new Error(`Deepgram grant failed (${res.status})`);

  return NextResponse.json({ accessToken: body.access_token }, { headers: { 'cache-control': 'no-store' } });
});

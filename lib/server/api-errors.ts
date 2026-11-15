import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export function withApiErrors(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
        return NextResponse.json({ ok: false, error: 'Please sign in.' }, { status: 401 });
      }
      if (error instanceof Anthropic.APIError) {
        const billing = /credit balance/i.test(error.message);
        return NextResponse.json({
          ok: false,
          error: billing
            ? 'AI generation is unavailable. The service account needs API credits.'
            : 'The AI service is temporarily unavailable. Please try again later.',
        }, { status: 503 });
      }
      console.error('API request failed', error instanceof Error ? error.message : 'Database request failed');
      return NextResponse.json({ ok: false, error: 'Unable to complete this request. Please try again.' }, { status: 500 });
    }
  };
}

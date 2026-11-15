import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jev, JevError } from './client';

const OK = {
  model: 'jev-latest',
  answers: { dnc: { type: 'noul', noul: 0.1 } },
  usage: {},
};

function res(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('jev client', () => {
  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries 429 twice then resolves after 3 calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, { error: 'slow down' }))
      .mockResolvedValueOnce(res(429, { error: 'slow down' }))
      .mockResolvedValueOnce(res(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    const answers = await jev({ a: 1 }, { dnc: { type: 'noul', instructions: 'x' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(answers.dnc).toEqual({ type: 'noul', noul: 0.1 });
  });

  it('throws JevError with status on 401 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(401, { error: 'bad key' }));
    vi.stubGlobal('fetch', fetchMock);
    const err = await jev({}, { q: { type: 'noul', instructions: 'x' } }).catch((e) => e);
    expect(err).toBeInstanceOf(JevError);
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends model jev-latest, bearer auth, state and questions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    const questions = { dnc: { type: 'noul' as const, instructions: 'x' } };
    await jev({ owner_said: 'hi' }, questions);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body)).toEqual({
      model: 'jev-latest',
      state: { owner_said: 'hi' },
      questions,
    });
  });
});

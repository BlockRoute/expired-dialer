const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const BACKOFF_MS = [250, 500, 1000];

export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } };

export type JevAnswers = Record<
  string,
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'noul'; noul: number }
>;

export class JevError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function jev(
  state: unknown,
  questions: Record<string, JevQuestion>,
  opts: { timeoutMs?: number } = {},
): Promise<JevAnswers> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new JevError('TYPESAFE_API_KEY is not set', 0);
  const body = JSON.stringify({ model: MODEL, state, questions });
  const timeoutMs = opts.timeoutMs ?? 3000;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new JevError(`TypeSafe request failed: ${(e as Error).message}`, 0);
    }
    if ((res.status === 429 || res.status === 529) && attempt < BACKOFF_MS.length) {
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new JevError(`TypeSafe HTTP ${res.status}`, res.status, text.slice(0, 500));
    return (JSON.parse(text) as { answers: JevAnswers }).answers;
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...a: unknown[]) => create(...a) };
  },
}));

import { runClaude, usableText } from './anthropic';

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ content: [], stop_reason: 'end_turn' });
});

const base = { system: 'S', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('runClaude request params', () => {
  it('passes an explicit thinking config and effort through', async () => {
    await runClaude({ ...base, model: 'claude-haiku-5-5', thinking: { type: 'disabled' }, effort: 'low', maxTokens: 300 });
    const params = create.mock.calls[0][0];
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.max_tokens).toBe(300);
  });

  it('omits thinking and output_config when not given', async () => {
    await runClaude(base);
    const params = create.mock.calls[0][0];
    expect('thinking' in params).toBe(false);
    expect('output_config' in params).toBe(false);
  });
});

describe('usableText', () => {
  const msg = (stop_reason: string, text?: string) =>
    ({ stop_reason, content: text === undefined ? [{ type: 'thinking', thinking: '' }] : [{ type: 'text', text }] }) as never;

  it('returns the text of a finished reply', () => expect(usableText(msg('end_turn', ' {"a":1} '))).toBe('{"a":1}'));
  it('null when the reply hit max_tokens, even with partial text', () => expect(usableText(msg('max_tokens', '{"a":'))).toBeNull());
  it('null on a refusal', () => expect(usableText(msg('refusal', 'no'))).toBeNull());
  it('null when only thinking came back', () => expect(usableText(msg('end_turn'))).toBeNull());
});

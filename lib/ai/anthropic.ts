import Anthropic from '@anthropic-ai/sdk';

// Single default model for Expired Dialer AI calls (coaching, summaries).
export const DEFAULT_MODEL = 'claude-opus-4-8';

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let _client: Anthropic | null = null;
export function anthropic() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

type RunArgs = {
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  model?: string;
  maxTokens?: number;
  thinking?: boolean; // adaptive thinking on/off (off for simple extraction)
  toolChoice?: Anthropic.MessageCreateParams['tool_choice'];
};

// System prompts must stay byte-stable across requests so the prompt cache
// (cache_control on the last system block, covering tools + system) can hit.
// Inject anything volatile (dates, lead data) into the user message instead.
function cachedSystem(system: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

// Single entry point for one-shot Claude calls.
export async function runClaude(args: RunArgs): Promise<Anthropic.Message> {
  const {
    system,
    messages,
    tools,
    model = DEFAULT_MODEL,
    maxTokens = 8_000,
    thinking = false,
    toolChoice,
  } = args;

  return anthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system: cachedSystem(system),
    messages,
    ...(tools && tools.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
  });
}

// Streaming variant — for surfaces that render token-by-token.
export function streamClaude(args: RunArgs) {
  const {
    system,
    messages,
    tools,
    model = DEFAULT_MODEL,
    maxTokens = 16_000,
    thinking = false,
    toolChoice,
  } = args;

  return anthropic().messages.stream({
    model,
    max_tokens: maxTokens,
    system: cachedSystem(system),
    messages,
    ...(tools && tools.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
  });
}

// Pull plain text out of a response.
export function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// Pull tool_use blocks for the manual tool loop.
export function extractToolUses(message: Anthropic.Message): Anthropic.ToolUseBlock[] {
  return message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
}

// Parse JSON the model was instructed to emit. Tolerates ```json fences and
// surrounding prose; returns null on failure (caller decides the fallback).
export function extractJson<T>(text: string): T | null {
  const candidates = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);
  const bare = text.match(/[[{][\s\S]*[\]}]/);
  if (bare) candidates.push(bare[0]);
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // try next candidate
    }
  }
  return null;
}

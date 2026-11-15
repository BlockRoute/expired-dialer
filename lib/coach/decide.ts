export type CardAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };

export type CardDecision =
  | { mode: 'single'; keys: [string] }
  | { mode: 'pair'; keys: [string, string] }
  | { mode: 'none' }
  | { mode: 'fallback' };

const CONFIDENT = 0.6;
const SUBSTANTIVE_WORDS = 6;

export function decideCards(answer: CardAnswer, ownerSaid: string): CardDecision {
  if (answer.choice === 'none') {
    const words = ownerSaid.trim().split(/\s+/).filter(Boolean).length;
    return words >= SUBSTANTIVE_WORDS ? { mode: 'fallback' } : { mode: 'none' };
  }
  if (answer.confidence >= CONFIDENT) return { mode: 'single', keys: [answer.choice] };
  const second = Object.entries(answer.probabilities)
    .filter(([k]) => k !== 'none' && k !== answer.choice)
    .sort((a, b) => b[1] - a[1])[0];
  return second ? { mode: 'pair', keys: [answer.choice, second[0]] } : { mode: 'single', keys: [answer.choice] };
}

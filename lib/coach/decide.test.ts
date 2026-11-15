import { describe, expect, it } from 'vitest';
import { decideCards } from './decide';

describe('decideCards', () => {
  it('pairs the top two when confidence is under 0.6', () => {
    const r = decideCards(
      { choice: 'buying_signal', confidence: 0.56, probabilities: { buying_signal: 0.56, commission_objection: 0.4, none: 0.04 } },
      'what would you charge me',
    );
    expect(r).toEqual({ mode: 'pair', keys: ['buying_signal', 'commission_objection'] });
  });
  it('excludes none from the pair', () => {
    const r = decideCards(
      { choice: 'a', confidence: 0.4, probabilities: { a: 0.4, none: 0.35, b: 0.25 } },
      'x',
    );
    expect(r).toEqual({ mode: 'pair', keys: ['a', 'b'] });
  });
  it('none with a short line shows nothing', () => {
    expect(decideCards({ choice: 'none', confidence: 0.9, probabilities: { none: 0.9, a: 0.1 } }, 'uh')).toEqual({ mode: 'none' });
  });
  it('none with a substantive line (>=6 words) falls back', () => {
    const r = decideCards(
      { choice: 'none', confidence: 0.8, probabilities: { none: 0.8, a: 0.2 } },
      'we have a cousin who might buy it',
    );
    expect(r).toEqual({ mode: 'fallback' });
  });
  it('shows one card when confident', () => {
    const r = decideCards({ choice: 'a', confidence: 0.91, probabilities: { a: 0.91, b: 0.09 } }, 'x');
    expect(r).toEqual({ mode: 'single', keys: ['a'] });
  });
});

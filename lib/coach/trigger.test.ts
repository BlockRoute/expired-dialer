import { describe, expect, it } from 'vitest';
import { createOwnerTurnTrigger } from './trigger';

describe('createOwnerTurnTrigger', () => {
  it('fires once per owner turn; a rep final starts the next turn', () => {
    const t = createOwnerTurnTrigger();
    expect(t.ready()).toBe(true);
    t.markFired(); // speech_final
    expect(t.ready()).toBe(false); // UtteranceEnd for the same turn
    t.onRepFinal();
    expect(t.ready()).toBe(true);
  });
  it('stays ready until marked fired', () => {
    const t = createOwnerTurnTrigger();
    expect(t.ready()).toBe(true);
    expect(t.ready()).toBe(true);
  });
});

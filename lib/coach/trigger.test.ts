import { describe, expect, it } from 'vitest';
import { createOwnerTurnTrigger } from './trigger';

describe('createOwnerTurnTrigger', () => {
  it('fires again within a turn only when new owner text arrived', () => {
    const t = createOwnerTurnTrigger();
    expect(t.shouldFire('Yeah, uh')).toBe(true);
    expect(t.shouldFire('Yeah, uh')).toBe(false); // UtteranceEnd, nothing new
    expect(t.shouldFire("Yeah, uh we're going to relist with Susan")).toBe(true);
  });
  it('a rep final starts a new turn', () => {
    const t = createOwnerTurnTrigger();
    expect(t.shouldFire('hello')).toBe(true);
    t.onRepFinal();
    expect(t.shouldFire('hello')).toBe(true);
  });
  it('never fires on empty text', () => {
    expect(createOwnerTurnTrigger().shouldFire('')).toBe(false);
  });
});

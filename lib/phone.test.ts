import { describe, it, expect } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each(['(804) 555-0142', '804.555.0142', '1-804-555-0142', '8045550142 x12', '+18045550142', '+1 (804) 555-0142'])(
    'normalizes %s',
    (raw) => expect(normalizePhone(raw)).toBe('+18045550142'),
  );
  it('is idempotent', () =>
    expect(normalizePhone(normalizePhone('(804) 555-0142')!)).toBe('+18045550142'));
  it.each(['555-0142', '+44 20 7946 0958', ''])('rejects %j', (raw) =>
    expect(normalizePhone(raw)).toBeNull(),
  );
});

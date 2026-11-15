import { describe, it, expect } from 'vitest';
import { easternParts } from './time';

describe('easternParts', () => {
  it('spring forward: 03:00 EDT', () => {
    expect(easternParts(new Date('2026-03-08T07:00:00Z')).minutes).toBe(180);
  });
  it('fall back: second 01:30 pass is EST', () => {
    expect(easternParts(new Date('2026-11-01T06:30:00Z')).minutes).toBe(90);
  });
  it('weekday and date', () => {
    const p = easternParts(new Date('2026-11-15T15:00:00Z'));
    expect(p.weekday).toBe(0);
    expect(p.date).toBe('2026-11-15');
  });
  it('date uses Eastern, not UTC', () => {
    expect(easternParts(new Date('2026-11-16T03:00:00Z')).date).toBe('2026-11-15');
  });
});

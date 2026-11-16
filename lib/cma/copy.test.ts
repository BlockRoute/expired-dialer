import { describe, it, expect } from 'vitest';
import { cleanNote, parseDraft, DRAFT_SYSTEM_PROMPT } from './copy';

describe('cleanNote', () => {
  it('replaces em-dashes and exclamation marks, keeps en-dash ranges', () => {
    const out = cleanNote('Corner lot — quiet street! Priced $395k–$415k.');
    expect(out).not.toMatch(/—|!/);
    expect(out).toContain('$395k–$415k');
  });
  it('trims and collapses whitespace', () => {
    expect(cleanNote('  a \n b  ')).toBe('a b');
  });
});

describe('parseDraft', () => {
  it('reads favor/weigh JSON and cleans both', () => {
    expect(parseDraft('{"favor":"Big lot!","weigh":"Older roof — 2008."}')).toEqual({ favor: 'Big lot.', weigh: 'Older roof, 2008.' });
  });
  it('returns null on junk', () => {
    expect(parseDraft('sorry')).toBeNull();
    expect(parseDraft('{"favor":1}')).toBeNull();
  });
});

describe('DRAFT_SYSTEM_PROMPT', () => {
  it('is a constant carrying the voice rules', () => {
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/em-dash/i);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/exclamation/i);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/Zestimate|AVM/);
  });
});

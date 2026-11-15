import { describe, expect, it } from 'vitest';
import type { JevAnswers } from '../typesafe/client';
import { MAX_TRANSCRIPT_CHARS, formatCallTranscript, hasOwnerSpeech, prefillFromAnswers } from './prefill';

const answers = (outcome: string, appointment: number, callback_time: number, dnc: number): JevAnswers => ({
  outcome: { type: 'choice', choice: outcome, confidence: 0.9, probabilities: { [outcome]: 0.9 } },
  appointment: { type: 'noul', noul: appointment },
  callback_time: { type: 'noul', noul: callback_time },
  dnc: { type: 'noul', noul: dnc },
});
const ALL = ['connected', 'dnc', 'appointment_set', 'callback_requested', 'not_interested', 'left_vm'];

describe('prefillFromAnswers', () => {
  it('dnc 0.97 overrides callback_requested and suggests DNC', () => {
    expect(prefillFromAnswers(answers('callback_requested', 0, 0, 0.97), ALL)).toEqual({
      outcome: 'dnc',
      openCallbackPicker: false,
      dncSuggested: true,
    });
  });
  it('appointment 0.9 gives appointment_set', () => {
    expect(prefillFromAnswers(answers('not_interested', 0.9, 0, 0.01), ALL).outcome).toBe('appointment_set');
  });
  it('appointment never overrides dnc', () => {
    expect(prefillFromAnswers(answers('connected', 0.9, 0, 0.9), ALL).outcome).toBe('dnc');
  });
  it('callback_time 0.8 opens the picker', () => {
    const p = prefillFromAnswers(answers('callback_requested', 0, 0.8, 0.01), ALL);
    expect(p).toEqual({ outcome: 'callback_requested', openCallbackPicker: true, dncSuggested: false });
  });
  it('dnc below 0.5 does not override', () => {
    const p = prefillFromAnswers(answers('not_interested', 0, 0, 0.49), ALL);
    expect(p).toEqual({ outcome: 'not_interested', openCallbackPicker: false, dncSuggested: false });
  });
  it('an outcome key not in settings is ignored', () => {
    expect(prefillFromAnswers(answers('relisted_elsewhere', 0, 0, 0.01), ALL).outcome).toBeNull();
    expect(prefillFromAnswers(answers('connected', 0.9, 0, 0), ['connected']).outcome).toBeNull();
  });
  it('dnc still suggested when dnc is not an enabled outcome', () => {
    const p = prefillFromAnswers(answers('connected', 0, 0, 0.9), ['connected']);
    expect(p).toMatchObject({ outcome: null, dncSuggested: true });
  });
  it('missing or malformed answers give no suggestion', () => {
    expect(prefillFromAnswers({}, ALL)).toEqual({ outcome: null, openCallbackPicker: false, dncSuggested: false });
  });
});

describe('formatCallTranscript', () => {
  const seg = (speaker: 'rep' | 'owner', text: string, t: number | null) => ({ speaker, text, t_start: t });
  it('orders by t_start and labels speakers', () => {
    const t = formatCallTranscript([seg('owner', 'Yes.', 2), seg('rep', 'Hi Jane?', 1)]);
    expect(t).toBe('Rep: Hi Jane?\nOwner: Yes.');
  });
  it('keeps only the last lines within the cap, on a line boundary', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => seg(i % 2 ? 'owner' : 'rep', `line number ${i}`, i));
    const t = formatCallTranscript(rows);
    expect(t.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(t.endsWith('line number 1999')).toBe(true);
    expect(t.startsWith('Rep: ') || t.startsWith('Owner: ')).toBe(true);
  });
  it('hasOwnerSpeech needs a non-empty owner segment', () => {
    expect(hasOwnerSpeech([seg('rep', 'hi', 1)])).toBe(false);
    expect(hasOwnerSpeech([seg('owner', '  ', 1)])).toBe(false);
    expect(hasOwnerSpeech([seg('owner', 'hello', 1)])).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { CallRow } from '@/lib/db/types';
import { dialCallStatus, nextCallState, twilioCallStatus } from './status';

const base: CallRow = {
  id: 'c1',
  lead_id: null,
  phone_id: null,
  direction: 'outbound',
  status: 'queued',
  twilio_parent_sid: 'CAparent',
  twilio_child_sid: null,
  started_at: null,
  answered_at: null,
  ended_at: null,
  outcome: null,
  outcome_saved_at: null,
  outcome_advance: null,
  note: null,
  recording_path: null,
  ai_summary: null,
  created_at: '2026-11-15T10:00:00Z',
};
const T1 = '2026-11-15T10:00:05Z';
const T2 = '2026-11-15T10:00:30Z';

describe('nextCallState', () => {
  it('moves forward and sets answered_at on first in-progress', () => {
    const patch = nextCallState({ ...base, status: 'ringing' }, { status: 'in-progress', at: T1 });
    expect(patch).toEqual({ status: 'in-progress', answered_at: T1 });
  });

  it('does not overwrite an existing answered_at', () => {
    const patch = nextCallState(
      { ...base, status: 'queued', answered_at: T1 },
      { status: 'in-progress', at: T2 },
    );
    expect(patch).toEqual({ status: 'in-progress' });
  });

  it('sets ended_at on first terminal state', () => {
    const patch = nextCallState({ ...base, status: 'in-progress', answered_at: T1 }, { status: 'completed', at: T2 });
    expect(patch).toEqual({ status: 'completed', ended_at: T2 });
  });

  it('ignores a late in-progress after completed', () => {
    const done = { ...base, status: 'completed' as const, answered_at: T1, ended_at: T2 };
    expect(nextCallState(done, { status: 'in-progress', at: '2026-11-15T10:01:00Z' })).toBeNull();
  });

  it('ignores a duplicate completed', () => {
    const done = { ...base, status: 'completed' as const, ended_at: T2 };
    expect(nextCallState(done, { status: 'completed', at: '2026-11-15T10:01:00Z' })).toBeNull();
  });

  it('terminal states are final even across different terminals', () => {
    const done = { ...base, status: 'no-answer' as const, ended_at: T2 };
    expect(nextCallState(done, { status: 'completed', at: '2026-11-15T10:01:00Z' })).toBeNull();
  });

  it('never moves backwards', () => {
    expect(nextCallState({ ...base, status: 'in-progress' }, { status: 'ringing', at: T1 })).toBeNull();
  });

  it('leaves a saved outcome untouched', () => {
    const row = { ...base, outcome: 'left_vm', outcome_saved_at: T1 };
    const patch = nextCallState(row, { status: 'ringing', at: T2 });
    expect(patch).toEqual({ status: 'ringing' });
    expect(patch).not.toHaveProperty('outcome');
    expect(patch).not.toHaveProperty('outcome_saved_at');
  });

  it('records the child sid when it is new', () => {
    const patch = nextCallState(base, { status: 'ringing', at: T1, childSid: 'CAchild' });
    expect(patch).toEqual({ status: 'ringing', twilio_child_sid: 'CAchild' });
  });

  it('records a child sid even when the status does not advance', () => {
    const patch = nextCallState({ ...base, status: 'ringing' }, { status: 'queued', at: T1, childSid: 'CAchild' });
    expect(patch).toEqual({ twilio_child_sid: 'CAchild' });
  });

  it('returns null when nothing changes', () => {
    const row = { ...base, status: 'ringing' as const, twilio_child_sid: 'CAchild' };
    expect(nextCallState(row, { status: 'ringing', at: T1, childSid: 'CAchild' })).toBeNull();
  });
});

describe('twilioCallStatus', () => {
  it('maps initiated to queued and passes known statuses through', () => {
    expect(twilioCallStatus('initiated')).toBe('queued');
    expect(twilioCallStatus('ringing')).toBe('ringing');
    expect(twilioCallStatus('in-progress')).toBe('in-progress');
    expect(twilioCallStatus('no-answer')).toBe('no-answer');
  });
  it('returns null for unknown values', () => {
    expect(twilioCallStatus('answered')).toBeNull();
    expect(twilioCallStatus(undefined)).toBeNull();
  });
});

describe('dialCallStatus', () => {
  it('treats answered as completed and passes terminals through', () => {
    expect(dialCallStatus('answered')).toBe('completed');
    expect(dialCallStatus('completed')).toBe('completed');
    expect(dialCallStatus('busy')).toBe('busy');
    expect(dialCallStatus('canceled')).toBe('canceled');
  });
  it('returns null for non-terminal or unknown values', () => {
    expect(dialCallStatus('ringing')).toBeNull();
    expect(dialCallStatus(undefined)).toBeNull();
  });
});

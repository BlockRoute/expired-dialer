import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '@/lib/test/fake-db';

let db: ReturnType<typeof fakeDb>;
const update = vi.fn();
vi.mock('@/lib/auth', () => ({ requireUserApi: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => db.client }));
vi.mock('@/lib/twilio/client', () => ({ twilioRestClient: () => ({ calls: () => ({ update }) }) }));

import { POST } from './route';

const drop = (body: object) => POST(new Request('http://x/api/twilio/vm-drop', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  update.mockReset();
  db = fakeDb({
    calls: [{ id: 'c1', outcome: 'connected', outcome_saved_at: '2026-11-16T17:00:00Z', twilio_child_sid: 'CA2', twilio_parent_sid: 'CA1' }],
    settings: [{ id: 1, voicemail_drops: [{ id: 'd1', label: 'Main', path: 'd1.mp3' }] }],
  });
});

describe('POST /api/twilio/vm-drop', () => {
  it('409 when an outcome is already saved: nothing plays, nothing is written', async () => {
    const res = await drop({ callId: 'c1', dropId: 'd1' });
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
    expect(db.log.filter((q) => q.op === 'update')).toEqual([]);
  });
});

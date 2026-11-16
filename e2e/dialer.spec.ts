/**
 * Dialer walk-through against a hosted Supabase project, with the Twilio Voice
 * SDK stubbed in the browser (no real calls are placed).
 *
 * Needs, in the environment of the test process:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  - to seed and clean up rows
 *   E2E_STORAGE_STATE  - Playwright storage state of a signed-in owner session
 *                        (pnpm exec playwright codegen --save-storage=auth.json http://localhost:3000/login)
 * The dev server (`pnpm dev`, started by playwright.config.ts) must point at the same project.
 *
 * The browser clock is pinned to a Tuesday at 10-11am Eastern so the dialer's
 * calling-hours preview does not depend on when the test runs.
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
test.skip(!url || !serviceKey || !process.env.E2E_STORAGE_STATE, 'e2e env vars are not set');

const ADDRESS_A = '9001 E2E Alpha St';
const ADDRESS_B = '9002 E2E Bravo St';
const PHONES_A = ['+18045550191', '+18045550192'];
const PHONE_B = '+18045550193';

/** Next Tuesday (or today if it is one), at 15:00 UTC = 10:00/11:00 Eastern. */
function pinnedTuesday() {
  const d = new Date();
  d.setUTCHours(15, 0, 0, 0);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const db = () => createClient(url!, serviceKey!, { auth: { persistSession: false } });

test.afterEach(async () => {
  const admin = db();
  await admin.from('leads').delete().in('property_address', [ADDRESS_A, ADDRESS_B]);
  await admin.from('dnc_numbers').delete().in('number', [...PHONES_A, PHONE_B]);
  await admin.from('import_batches').delete().eq('file_name', 'e2e-dialer');
});

test('load queue, call, no answer -> phone 2, DNC -> next lead', async ({ page }) => {
  const admin = db();
  const pinned = pinnedTuesday();

  // Seed: one scrubbed batch; lead A (two phones) ahead of lead B (one phone) in the queue.
  const { data: batch } = await admin
    .from('import_batches')
    // Yesterday: never after today on the server's real clock (a future scrub date blocks), and within 90 days of the pinned clock.
    .insert({ file_name: 'e2e-dialer', vendor: 'e2e', scrub_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), scrubbed_by_vendor: true })
    .select('id')
    .single();
  const seedLead = async (property_address: string, expired_date: string, numbers: string[]) => {
    const { data: lead } = await admin
      .from('leads')
      .insert({ property_address, owner_full_name: 'E2E Owner', expired_date, batch_id: batch!.id, normalized_address: `e2e ${property_address}` })
      .select('id')
      .single();
    await admin.from('phones').insert(
      numbers.map((number, i) => ({ lead_id: lead!.id, number, position: i + 1, vendor_dnc: 'callable', batch_id: batch!.id })),
    );
    return lead!.id as string;
  };
  const leadA = await seedLead(ADDRESS_A, '2099-01-02', PHONES_A);
  await seedLead(ADDRESS_B, '2099-01-01', [PHONE_B]);

  // The stubbed Device stands in for the voice route: it asks the test to create the calls row.
  let sidCounter = 0;
  await page.exposeFunction('__stubConnect', async (params: Record<string, string>) => {
    const sid = `CAe2e${Date.now()}${sidCounter++}`;
    await admin.from('calls').insert({
      lead_id: params.LeadId,
      phone_id: params.PhoneId,
      direction: 'outbound',
      status: 'in-progress',
      twilio_parent_sid: sid,
    });
    return sid;
  });
  await page.addInitScript(() => {
    type Handler = () => void;
    class StubCall {
      parameters: Record<string, string> = {};
      private handlers: Record<string, Handler[]> = {};
      on(event: string, cb: Handler) {
        (this.handlers[event] ??= []).push(cb);
        return this;
      }
      emit(event: string) {
        for (const cb of this.handlers[event] ?? []) cb();
      }
      disconnect() {
        this.emit('disconnect');
      }
    }
    class StubDevice {
      constructor(public token: string) {}
      on() {
        return this;
      }
      updateToken() {}
      destroy() {}
      async connect({ params }: { params: Record<string, string> }) {
        const call = new StubCall();
        call.parameters.CallSid = await (window as unknown as { __stubConnect: (p: Record<string, string>) => Promise<string> }).__stubConnect(params);
        setTimeout(() => call.emit('accept'), 0);
        return call;
      }
    }
    (window as unknown as { Twilio: unknown }).Twilio = { Device: StubDevice };
  });
  await page.route('**/api/twilio/token', (route) =>
    route.fulfill({ json: { ok: true, token: 'stub-token' } }),
  );
  await page.clock.setFixedTime(pinned);

  await page.goto('/dialer');
  const queueCount = page.getByTestId('queue-count');
  await expect(page.getByRole('heading', { name: new RegExp(ADDRESS_A) })).toBeVisible();
  const before = Number((await queueCount.innerText()).split(' ')[0]);

  // Phone 1: call, mark No answer -> advances to phone 2 on the same lead.
  const phones = page.getByTestId('phones').locator('li');
  await expect(phones.nth(0)).toContainText('ready');
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await expect(phones.nth(0)).toContainText('in call');
  await page.getByRole('button', { name: /^No answer/ }).click();
  await expect(phones.nth(1)).toContainText('ready');
  await expect(phones.nth(0)).toContainText('tried');
  await expect(page.getByRole('heading', { name: new RegExp(ADDRESS_A) })).toBeVisible();

  // Phone 2: call, mark DNC -> lead leaves the queue, lead B loads.
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await expect(phones.nth(1)).toContainText('in call');
  await page.getByRole('button', { name: /^DNC/ }).click();
  await expect(page.getByRole('heading', { name: new RegExp(ADDRESS_B) })).toBeVisible();
  await expect(queueCount).toHaveText(`${before - 1} left`);

  // Database effects.
  const { data: lead } = await admin.from('leads').select('status').eq('id', leadA).single();
  expect(lead!.status).toBe('dnc');
  // A DNC outcome covers every number on the lead, not only the one dialed.
  const { data: dnc } = await admin.from('dnc_numbers').select('number').in('number', PHONES_A);
  expect(dnc).toHaveLength(PHONES_A.length);
  const { data: calls } = await admin.from('calls').select('outcome').eq('lead_id', leadA).order('created_at');
  expect(calls!.map((c) => c.outcome)).toEqual(['no_answer', 'dnc']);
});

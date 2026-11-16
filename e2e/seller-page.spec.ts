/**
 * Public seller comp page, against a hosted Supabase project (runs in Task 15).
 *
 * Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (to seed and clean up rows only; the page
 * itself reads through the get_published_cma RPC with the anon key). No signed-in session is used.
 * The phone-width stacking check (map stacks under 860px) is also Task 15.
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
test.skip(!url || !serviceKey, 'e2e env vars are not set');
test.use({ storageState: { cookies: [], origins: [] } });

const SLUG = '4417-grove-ave-e2eseedslug2222222222222a';
const UNPUBLISHED = '4417-grove-ave-e2eunpublished22222222222';
const row = (slug: string, published: boolean) => ({
  address: '4417 Grove Ave, Richmond, VA 23221',
  subject: { lat: 37.5539, lng: -77.4837, beds: 3, baths: 2, sqft: 1800, yearBuilt: 1948, lotSqft: 6200, taxAssessed: 512000 },
  comps: [
    { zpid: '1001', address: '4501 Grove Ave, Richmond, VA 23221', lat: 37.5545, lng: -77.4801, soldPrice: 410000, soldDate: '2026-10-02', dom: 12, beds: 3, baths: 2, sqft: 1750, yearBuilt: 1950, lotSqft: 5800, ppsf: 234.29, distanceMiles: 0.2, zillowUrl: 'https://www.zillow.com/homedetails/1001_zpid/' },
  ],
  price_range: { low: 395000, high: 415000, point: 405000, medianPpsf: 225 },
  time_window: '90_days',
  radius_miles: 0.6,
  favor_note: 'Corner lot with a detached garage.',
  weigh_note: 'Original windows.',
  published_slug: slug,
  published_at: published ? new Date().toISOString() : null,
});

test.describe('seller page', () => {
  const admin = () => createClient(url!, serviceKey!, { auth: { persistSession: false } });

  test.beforeAll(async () => {
    const { error } = await admin().from('cmas').insert([row(SLUG, true), row(UNPUBLISHED, false)]);
    if (error) throw error;
  });
  test.afterAll(async () => {
    await admin().from('cmas').delete().in('published_slug', [SLUG, UNPUBLISHED]);
  });

  test('published CMA renders title, noindex, footer credential, no em-dash', async ({ page }) => {
    const res = await page.goto(`/c/${SLUG}`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle('4417 Grove Ave Comps');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByText('eXp Realty · Seller Representative Specialist (SRS) · danielyoonrealty.com')).toBeVisible();
    expect(await page.content()).not.toContain('—');
  });

  test('unpublished slug returns 404', async ({ page }) => {
    const res = await page.goto(`/c/${UNPUBLISHED}`);
    expect(res?.status()).toBe(404);
  });

  test('unknown slug returns 404', async ({ page }) => {
    const res = await page.goto('/c/does-not-exist');
    expect(res?.status()).toBe(404);
  });
});

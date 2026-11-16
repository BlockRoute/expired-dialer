import type { PublishedCma } from '../seller';

/** Shape the get_published_cma RPC returns for a published CMA (excluded comps already removed). */
export const PUBLISHED: PublishedCma = {
  address: '4417 Grove Ave, Richmond, VA 23221',
  subject: { lat: 37.5539, lng: -77.4837, beds: 3, baths: 2, sqft: 1800, yearBuilt: 1948, lotSqft: 6200, taxAssessed: 512000 },
  comps: [
    { zpid: '1001', address: '4501 Grove Ave, Richmond, VA 23221', lat: 37.5545, lng: -77.4801, soldPrice: 410000, soldDate: '2026-10-02', dom: 12, beds: 3, baths: 2, sqft: 1750, yearBuilt: 1950, lotSqft: 5800, ppsf: 234.29, distanceMiles: 0.2, zillowUrl: 'https://www.zillow.com/homedetails/1001_zpid/' },
    { zpid: '1002', address: '4310 Kensington Ave, Richmond, VA 23221', lat: 37.5521, lng: -77.4869, soldPrice: 395000, soldDate: '2026-09-18', dom: null, beds: 3, baths: 1.5, sqft: 1820, yearBuilt: 1946, lotSqft: 6000, ppsf: 217.03, distanceMiles: 0.25, zillowUrl: 'https://www.zillow.com/homedetails/1002_zpid/' },
    { zpid: '1003', address: '4602 Patterson Ave, Richmond, VA 23221', lat: 37.5558, lng: -77.4772, soldPrice: 415000, soldDate: '2026-08-30', dom: 31, beds: 4, baths: 2, sqft: 1900, yearBuilt: 1952, lotSqft: 6500, ppsf: 218.42, distanceMiles: 0.4, zillowUrl: 'https://www.zillow.com/homedetails/1003_zpid/' },
  ],
  actives: [
    { zpid: '2001', address: '4425 Grove Ave, Richmond, VA 23221', lat: 37.5541, lng: -77.4829, listPrice: 439000, beds: 3, baths: 2, sqft: 1850, dom: 9, distanceMiles: 0.05, zillowUrl: 'https://www.zillow.com/homedetails/2001_zpid/' },
  ],
  price_range: { low: 395000, high: 415000, point: 405000, medianPpsf: 225 },
  time_window: '90_days',
  radius_miles: 0.6,
  favor_note: 'Corner lot with a detached garage. Updated kitchen.',
  weigh_note: 'One full bath fewer than the closest sale. Original windows.',
  published_at: '2026-11-15T14:00:00Z',
};

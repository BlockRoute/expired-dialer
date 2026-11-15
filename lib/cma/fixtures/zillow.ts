// Schema-derived fixtures: hand-built from the RealtyAPI endpoint schemas (parameters) and the
// cma-comp-map skill's field names, with realistic Richmond-area values. Not captured from a live
// response. The vendor value-estimate fields are included on purpose to prove the allowlist drops them.
import type { Subject } from '../types';

export const SUBJECT: Subject = {
  zpid: '11223344',
  lat: 37.544,
  lng: -77.49,
  beds: 4,
  baths: 2.5,
  sqft: 2010,
  yearBuilt: 1996,
  lotSqft: 9500,
  taxAssessed: 297000,
  homeType: 'SINGLE_FAMILY',
};

/** Raw `GET /pro/byaddress` body shape (flat property record). */
export function byAddressResponse() {
  return {
    zpid: 11223344,
    streetAddress: '2812 Amherst Ridge Dr',
    city: 'Richmond',
    state: 'VA',
    zipcode: '23235',
    latitude: 37.544,
    longitude: -77.49,
    bedrooms: 4,
    bathrooms: 2.5,
    livingArea: 2010,
    yearBuilt: 1996,
    lotSize: 9500,
    taxAssessedValue: 297000,
    homeType: 'SINGLE_FAMILY',
    zestimate: 431000,
    rentZestimate: 2650,
    zestimateLowPercent: 5,
    nearbyHomes: [{ zpid: 99, zestimate: 1 }],
  };
}

const STREETS = ['Amherst Ridge Dr', 'Reedy Knoll Ct', 'Bibb Ave', 'Westham Rd', 'Cary Hill Ln', 'Hampton Glen Dr', 'Old Hundred Rd', 'Salem Church Rd', 'Kings Pl'];

/** Raw `GET /search/bycoordinates` body: `n` credible newest-first sold homes near SUBJECT. */
export function soldSearch(n: number) {
  const results = Array.from({ length: n }, (_, i) => {
    const sold = Date.UTC(2026, 9, 28 - i * 6);
    return {
      zpid: String(5000 + i),
      address: `${2800 + i * 4} ${STREETS[i % STREETS.length]}, Richmond, VA 23235`,
      latitude: SUBJECT.lat + 0.002 * (i + 1),
      longitude: SUBJECT.lng + 0.003,
      price: 395000 + i * 8000,
      lastSoldDate: sold,
      listingDateTimeOnZillow: sold - (21 + i * 3) * 86_400_000,
      daysOnZillow: 14,
      bedrooms: 4,
      bathrooms: 2.5,
      livingArea: 1950 + i * 20,
      yearBuilt: 1994 + (i % 4),
      lotSize: 9000 + i * 100,
      zestimate: 450000,
      rentZestimate: 2800,
    };
  });
  return { results };
}

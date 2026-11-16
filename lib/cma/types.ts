/** Allowlisted subject facts. Nothing else from the vendor record is kept. */
export type Subject = {
  zpid: string;
  lat: number;
  lng: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  lotSqft: number | null;
  taxAssessed: number | null;
  homeType: string | null;
};

/** One Zillow sold-search hit, allowlisted. Dates are epoch ms as Zillow sends them. */
export type RawComp = {
  zpid: string;
  address: string;
  lat: number;
  lng: number;
  soldPrice: number | null;
  soldDate: number | null;
  listingDate: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  lotSqft: number | null;
};

export type Window = { soldInLast: string; radius: number };

export type Comp = {
  zpid: string;
  address: string;
  lat: number;
  lng: number;
  soldPrice: number;
  /** yyyy-mm-dd, UTC */
  soldDate: string;
  /** Days from first Zillow listing date to sold date; null when the listing date is missing. */
  dom: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number;
  yearBuilt: number | null;
  lotSqft: number | null;
  ppsf: number;
  distanceMiles: number;
  zillowUrl: string;
};

/** One Zillow for-sale search hit, allowlisted. No value estimates. */
export type RawActive = {
  zpid: string;
  address: string;
  lat: number;
  lng: number;
  listPrice: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  /** Days on Zillow for an active listing. */
  dom: number | null;
};

/** Active competition shown on the seller page. Never enters indicatedValue. */
export type Active = RawActive & { distanceMiles: number; zillowUrl: string };

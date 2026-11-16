import type { Metadata } from 'next';
import type { Comp } from './types';

/** What `get_published_cma` returns: page fields only, excluded comps already removed. */
export type PublishedCma = {
  address: string;
  subject: {
    lat: number; lng: number; beds: number | null; baths: number | null;
    sqft: number | null; yearBuilt: number | null; lotSqft: number | null; taxAssessed: number | null;
  };
  comps: Comp[];
  price_range: { low: number; high: number; point?: number; medianPpsf: number };
  time_window: string | null;
  radius_miles: number | null;
  favor_note: string | null;
  weigh_note: string | null;
  published_at: string;
};

export const streetOf = (address: string) => address.split(',')[0].trim();

export function sellerMetadata(address: string): Metadata {
  return { title: `${streetOf(address)} Comps`, robots: 'noindex' };
}

/** Dashed ring radii (miles) sized to the comp spread, per the comp-map skill. */
export function ringsFor(maxMiles: number): [number, number] {
  if (maxMiles <= 0.3) return [0.1, 0.2];
  if (maxMiles <= 0.75) return [0.25, 0.5];
  return [0.5, 1];
}

/** Comp closest to the subject's square footage; the most recent sale wins a tie. */
export function closestMatch<T extends Pick<Comp, 'sqft' | 'soldDate'>>(subject: { sqft: number | null }, comps: T[]): T | null {
  if (!subject.sqft || comps.length === 0) return null;
  const sqft = subject.sqft;
  return [...comps].sort(
    (a, b) => Math.abs(a.sqft - sqft) - Math.abs(b.sqft - sqft) || b.soldDate.localeCompare(a.soldDate),
  )[0];
}

export const WINDOW_LABEL: Record<string, string> = {
  '90_days': 'last 3 months',
  '6_months': 'last 6 months',
  '12_months': 'last 12 months',
  '24_months': 'last 24 months',
};

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const moneyK = (n: number) => `$${Math.round(n / 1000)}k`;
export const dateLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

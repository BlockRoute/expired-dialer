const ABBREVIATIONS: Record<string, string> = {
  AVENUE: 'AVE',
  STREET: 'ST',
  ROAD: 'RD',
  DRIVE: 'DR',
  COURT: 'CT',
  LANE: 'LN',
  BOULEVARD: 'BLVD',
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
};

/** Canonical address key: uppercase, no punctuation, standard abbreviations, plus 5-digit zip. */
export function normalizeAddress(street: string, zip: string | null): string {
  const base = street
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join(' ');
  const zip5 = (zip ?? '').match(/\d{5}/)?.[0];
  return zip5 ? `${base} ${zip5}` : base;
}

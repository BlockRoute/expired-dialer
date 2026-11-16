const ABBREVIATIONS: Record<string, string> = {
  AVENUE: 'AVE',
  STREET: 'ST',
  ROAD: 'RD',
  DRIVE: 'DR',
  COURT: 'CT',
  LANE: 'LN',
  BOULEVARD: 'BLVD',
  CIRCLE: 'CIR',
  PLACE: 'PL',
  PARKWAY: 'PKWY',
  PKY: 'PKWY',
  TERRACE: 'TER',
  TERR: 'TER',
  WY: 'WAY',
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
  // Unit designators all become UNIT, so "Apt 4", "#4" and "Ste 4" are one address.
  APARTMENT: 'UNIT',
  APT: 'UNIT',
  SUITE: 'UNIT',
  STE: 'UNIT',
};

/** Canonical address key: uppercase, no punctuation, standard abbreviations, plus 5-digit zip. */
export function normalizeAddress(street: string, zip: string | null): string {
  const base = street
    .toUpperCase()
    .replace(/#/g, ' UNIT ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBREVIATIONS[w] ?? w)
    .filter((w, i, all) => !(w === 'UNIT' && all[i - 1] === 'UNIT')) // "Apt #4"
    .join(' ');
  const zip5 = (zip ?? '').match(/\d{5}/)?.[0];
  return zip5 ? `${base} ${zip5}` : base;
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const SUFFIX_CHARS = 26; // 26 x 5 bits = 130 bits

/** `<house#>-<street>-<26 random base32 chars>`, lowercase and hyphenated. Unguessable: the link is the access control. */
export function makeSlug(street: string): string {
  const base = street
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(SUFFIX_CHARS));
  // 256 is a multiple of 32, so the modulo is unbiased.
  const suffix = Array.from(bytes, (b) => B32[b % 32]).join('');
  return `${base}-${suffix}`;
}

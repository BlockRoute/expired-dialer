/** Normalize a US/NANP phone number to +1XXXXXXXXXX, or null if invalid. */
export function normalizePhone(raw: string): string | null {
  const noExt = raw.replace(/\s*(?:x|ext\.?)\s*\d+\s*$/i, '');
  if (/^\s*\+/.test(noExt) && !/^\s*\+1(?!\d)/.test(noExt)) return null;
  let digits = noExt.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

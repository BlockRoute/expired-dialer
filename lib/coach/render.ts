export type RenderLead = {
  first_name?: string | null;
  owner_first_name?: string | null;
  owner_last_name?: string | null;
  property_city?: string | null;
  list_price?: number | null;
  days_on_market?: number | null;
};

const k = (n: number) => `$${Math.round(n / 1000)}k`;

/** Vendor lists often arrive ALL CAPS ("O'BRIEN"); show them as "O'Brien". Mixed case is left alone. */
function nameCase(s: string | null | undefined): string {
  if (!s) return '';
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export function renderSay(say: string, lead: RenderLead, cma: { low: number; high: number } | null): string {
  const vars: Record<string, string> = {
    'lead.first_name': nameCase(lead.first_name ?? lead.owner_first_name),
    'lead.last_name': nameCase(lead.owner_last_name),
    'lead.city': nameCase(lead.property_city) || 'your area',
    'lead.list_price': lead.list_price != null ? k(lead.list_price) : '',
    'lead.days_on_market': lead.days_on_market != null ? String(lead.days_on_market) : '',
    'cma.range': cma ? `${k(cma.low)}–${k(cma.high)}` : '',
  };
  return say.replace(/%([a-z_.]+)%/gi, (_, name: string) => vars[name] ?? '').trim();
}

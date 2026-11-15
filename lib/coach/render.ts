export type RenderLead = {
  first_name?: string | null;
  owner_first_name?: string | null;
  list_price?: number | null;
  days_on_market?: number | null;
};

const k = (n: number) => `$${Math.round(n / 1000)}k`;

export function renderSay(say: string, lead: RenderLead, cma: { low: number; high: number } | null): string {
  const vars: Record<string, string> = {
    'lead.first_name': lead.first_name ?? lead.owner_first_name ?? '',
    'lead.list_price': lead.list_price != null ? k(lead.list_price) : '',
    'lead.days_on_market': lead.days_on_market != null ? String(lead.days_on_market) : '',
    'cma.range': cma ? `${k(cma.low)}–${k(cma.high)}` : '',
  };
  return say.replace(/%([a-z_.]+)%/gi, (_, name: string) => vars[name] ?? '').trim();
}

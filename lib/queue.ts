import type { LeadRow } from './db/types';

const CLOSED = new Set<LeadRow['status']>(['dnc', 'dead', 'appointment', 'out_of_state']);
const ms = (iso: string) => new Date(iso).getTime();

/** Due callbacks (oldest due first), then fresh leads (newest expired_date first), then eligible retries (soonest eligible first). */
export function orderQueue(
  leads: (LeadRow & { dueCallbackAt: string | null })[],
  now: Date,
): LeadRow[] {
  const t = now.getTime();
  const open = leads.filter((l) => !CLOSED.has(l.status));
  const due = open
    .filter((l) => l.dueCallbackAt !== null && ms(l.dueCallbackAt) <= t)
    .sort((a, b) => ms(a.dueCallbackAt!) - ms(b.dueCallbackAt!));
  const rest = open.filter((l) => !due.includes(l));
  const fresh = rest
    .filter((l) => l.attempt_rounds === 0)
    .sort((a, b) => (b.expired_date ?? '').localeCompare(a.expired_date ?? ''));
  const retries = rest
    .filter((l) => l.attempt_rounds > 0 && (l.next_eligible_at === null || ms(l.next_eligible_at) <= t))
    .sort((a, b) => ms(a.next_eligible_at ?? '1970-01-01') - ms(b.next_eligible_at ?? '1970-01-01'));
  return [...due, ...fresh, ...retries];
}

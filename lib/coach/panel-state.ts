export type PanelCard = { key: string; title: string; say: string; why?: string; source: 'jev' | 'claude' };
export type PanelResponse = {
  turnId: number;
  cards: PanelCard[];
  dncP: number | null;
  paused?: boolean;
  coachCardId?: string | null;
};
export type PanelView =
  | { kind: 'ignore' }
  | { kind: 'paused' }
  | { kind: 'cards'; cards: PanelCard[]; coachCardId: string | null };

export const DNC_THRESHOLD = 0.5;

/**
 * Decides what a coach response (or a failed request: response null) does.
 * DNC applies on every response for the current call, stale or not; only the
 * cards are gated on the turn being the newest.
 */
export function resolveCoachResponse(input: {
  latestTurnId: number;
  currentCallId: string | null;
  requestCallId: string;
  turnId?: number;
  response: PanelResponse | null;
}): { reportDnc: boolean; view: PanelView } {
  const { latestTurnId, currentCallId, requestCallId, response } = input;
  if (currentCallId !== requestCallId) return { reportDnc: false, view: { kind: 'ignore' } };
  const reportDnc = response?.dncP != null && response.dncP >= DNC_THRESHOLD;
  const turnId = response?.turnId ?? input.turnId ?? latestTurnId;
  if (turnId < latestTurnId) return { reportDnc, view: { kind: 'ignore' } };
  if (!response || response.paused) return { reportDnc, view: { kind: 'paused' } };
  return { reportDnc, view: { kind: 'cards', cards: response.cards, coachCardId: response.coachCardId ?? null } };
}

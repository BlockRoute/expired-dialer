/**
 * Within one owner turn (it ends at the next rep final) every speech_final or
 * UtteranceEnd that adds new owner text fires again with the cumulative text,
 * so a short first fragment ("Yeah, uh") never uses up the turn.
 */
export function createOwnerTurnTrigger() {
  let last = '';
  return {
    shouldFire(ownerSaid: string): boolean {
      if (!ownerSaid || ownerSaid === last) return false;
      last = ownerSaid;
      return true;
    },
    onRepFinal: () => {
      last = '';
    },
  };
}

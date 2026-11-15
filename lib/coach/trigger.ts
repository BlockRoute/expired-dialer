/**
 * Coaching fires at most once per owner turn. An owner turn ends at the next
 * rep final, so a speech_final followed by an UtteranceEnd (or a second
 * speech_final) for the same turn does not fire twice.
 */
export function createOwnerTurnTrigger() {
  let fired = false;
  return {
    ready: () => !fired,
    markFired: () => {
      fired = true;
    },
    onRepFinal: () => {
      fired = false;
    },
  };
}

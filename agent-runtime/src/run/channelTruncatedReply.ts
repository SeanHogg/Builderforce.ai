/**
 * What a channel run does with a reply the output limit cut short: the shared stall ladder's rung, as data.
 *
 * The ladder itself (counting, re-stating, falling through, settling) is the agent's (`policy/stall/ladder`); the channel supplies only
 * which rung holds and the words. A cut-off reply is sent back twice to continue where it stopped. If it is still cut off after that, the
 * text is delivered as it is with a line saying so, and the run's answer carries the same line.
 */

import type { DeliveryTurn, LadderRung } from "@builderforce/agent-run";

/** The counter key of the rung (`RunState.stall.rungs`). */
export const TRUNCATED_REPLY_RUNG = "truncated_reply";

/** Continuations a cut-off reply is given before it is delivered as it is. */
export const MAX_REPLY_CONTINUATIONS = 2;

const CONTINUE =
  "Your last reply was cut off by the output limit. Continue exactly where it stopped, without repeating what you already wrote. If it is long, finish the part you were on and keep the rest short.";

/** Said after a reply that was still cut off once its continuations were spent. */
export const REPLY_CUT_OFF_NOTE = "[This reply was cut off by the output limit.]";

/** The rungs a channel turn must clear: a reply the output limit cut short continues, and settles with the note once it has been given its turns. */
export function channelDeliveryRungs(turn: DeliveryTurn): readonly LadderRung[] {
  if (turn.interruption !== "truncated") return [];
  return [
    {
      id: TRUNCATED_REPLY_RUNG,
      applies: true,
      restate: Array<string>(MAX_REPLY_CONTINUATIONS).fill(CONTINUE),
      free: MAX_REPLY_CONTINUATIONS,
      quote: true,
      spent: { settle: `${turn.content.trimEnd()}\n\n${REPLY_CUT_OFF_NOTE}` },
    },
  ];
}

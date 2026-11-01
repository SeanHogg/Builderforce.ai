/**
 * The Brain's HUMAN CHANNEL (PRD 35 §3.2 `HumanChannel`) - how the person is reached.
 *
 * `ask(question)` parks the run. On the Brain a question IS the run's reply (`ask_user` ends the run on a card the person answers
 * by sending their next message), so the channel answers `paused` and the question reaches the person as the settled reply.
 * There is no `approve`: governance gates are unbound on the Brain (parity ruling R10), and a tool's own confirm card is the run
 * cell's `pendingConfirm` (`runStore/callPreflight.ts`), raised by the tool dispatch, not by this channel.
 */

import type { HumanChannel } from '@builderforce/agent-run';

/** The channel for one run. */
export function brainHumanChannel(): HumanChannel {
  return {
    async ask() {
      return { kind: 'paused' };
    },
  };
}

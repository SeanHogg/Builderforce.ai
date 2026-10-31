/**
 * The Brain's HUMAN CHANNEL (PRD 35 §3.2 `HumanChannel`) — how the person is reached.
 *
 *   - `approve(gate)` is the CONFIRM GATE: the run cell publishes a `pendingConfirm`, whichever
 *     surface is mounted on the cell shows it (the panel's card, the native modal), and the
 *     answer comes back through `resolveRunConfirm`. A Stop declines it, so nothing waits
 *     forever (`runControl.ts`);
 *   - `ask(question)` parks the run. On the Brain a question IS the run's reply (`ask_user` ends
 *     the run on a card the person answers by sending their next message), so the channel
 *     answers `paused` and the question reaches the person as the settled reply.
 */

import type { HumanChannel, PolicyGate } from '@builderforce/agent-run';
import { requestRunConfirm } from '../runStore/runControl';
import type { RunKey } from '../runStore/runTypes';

/** What the confirm card is shown for a governance gate. */
export function confirmRequestFor(gate: PolicyGate): { name: string; args: unknown } {
  const reason = gate.reason ?? gate.directive;
  return {
    name: gate.tool && gate.tool !== '*' ? gate.tool : 'a tool call',
    args: { gate: gate.id, ...(reason ? { reason } : {}), ...(gate.paths?.length ? { paths: gate.paths } : {}) },
  };
}

/** The channel for one run, over its cell's confirm gate. */
export function brainHumanChannel(runKey: RunKey): HumanChannel {
  return {
    async ask() {
      return { kind: 'paused' };
    },
    async approve(gate: PolicyGate) {
      const ok = await requestRunConfirm(runKey, confirmRequestFor(gate));
      return ok ? { kind: 'answered', answer: 'approved' } : { kind: 'answered', answer: 'declined' };
    },
  };
}

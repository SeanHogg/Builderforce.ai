/**
 * The Brain's FINISH ports, handed to `openRun` as `surface.finish` (`run/runPrepared.ts`); the agent builds the finish module
 * from them (`createFinishHook`). Without them the agent runs its port-less default: the sign-off, deliverable and honesty
 * gates, and NO live-children hold - an owner could end its run while sub-agents it started were still working, and every report
 * that arrived afterwards woke it into a new run with no ask of its own (chats #60338 and #61651).
 *
 * The OPEN-WORK port (`runStore/openLinkedWorkHold.ts`) holds every end of a work-mode run while a ticket it owns is still
 * open (chat #276). After it in the sequence, the SPEC TICKET COVERAGE gate (`runStore/specTicketCoverageGate.ts`) holds a run
 * asked to ticket a spec's open items while one has no ticket (chat #157440).
 *
 * Only the ports the host actually binds are passed: with no `liveChildren` port there is no live-children hold (a surface
 * without delegation - the web Brain, the canvas). The port itself stands down where it does not apply (a sub-agent, a
 * `chat`-mode run, a host with no tool runner).
 */

import { workFinishPorts, type FinishPorts } from '@builderforce/agent-run';
import type { BrainRunRequest } from '../runStore/runTypes';

type OpenWorkPort = NonNullable<FinishPorts['openWork']>;

/**
 * The open-work SEQUENCE as the one `openWork` port: each gate in order, the first that holds wins (so a later gate is not
 * consulted, and does not count a hold, while an earlier one holds the run).
 */
function inSequence(gates: readonly OpenWorkPort[]): OpenWorkPort | undefined {
  if (gates.length <= 1) return gates[0];
  return async (ctx) => {
    for (const gate of gates) {
      const block = await gate(ctx);
      if (block) return block;
    }
    return null;
  };
}

/** The finish ports for one Brain run: `openWork` is one port or the run's open-work gate sequence. */
export function brainFinishPorts(req: Pick<BrainRunRequest, 'liveChildren' | 'work'>, openWork?: OpenWorkPort | readonly OpenWorkPort[]): FinishPorts {
  const work = typeof openWork === 'function' ? openWork : inSequence(openWork ?? []);
  return {
    // The run IS a delegation owner as soon as the host can say who its live children are: an owner, not only a child
    // (`parentRunId`), holds its end for them.
    ...(req.liveChildren ? { delegated: true, liveChildren: req.liveChildren } : {}),
    ...(work ? { openWork: work } : {}),
    ...(req.work ? workFinishPorts(req.work) : {}),
  };
}

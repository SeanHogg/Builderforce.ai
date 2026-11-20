/**
 * The agent's FINISH module, bound with the Brain's engine ports (`createFinishHook`, the seam the cloud adapter binds in
 * `cloudAdapterHooks.ts`). Until this, `runPrepared` passed no finish module, so the agent ran its port-less default: the
 * sign-off, deliverable and honesty gates, and NO live-children hold. An owner could therefore end its run - in prose or
 * through `finish` - while sub-agents it started were still working, and every report that arrived afterwards woke it into a
 * new run with no ask of its own (chats #60338 and #61651: 16 and more model turns spent in such wake runs).
 *
 * The OPEN-WORK port (`runStore/openLinkedWorkHold.ts`) holds every end of a work-mode run while a ticket it owns is still
 * open (chat #276: a run listed the PRD items it had not started and settled with its epic in_progress).
 *
 * Only the ports the host actually binds are passed: with no `liveChildren` port there is no live-children hold (a surface
 * without delegation — the web Brain, the canvas). Every Brain run binds `openWork` (`run/runPrepared.ts`); the port itself stands
 * down where it does not apply (a sub-agent, a `chat`-mode run, a host with no tool runner).
 */

import { createFinishHook, type FinishHook, type FinishPorts } from '@builderforce/agent-run';
import type { BrainRunRequest } from '../runStore/runTypes';

/** The finish module for one Brain run. */
export function brainFinishHook(req: Pick<BrainRunRequest, 'liveChildren'>, openWork?: FinishPorts['openWork']): FinishHook {
  const ports: FinishPorts = {
    ...(req.liveChildren
      ? {
          // The run IS a delegation owner as soon as the host can say who its live children are: an owner, not only a child
          // (`parentRunId`), holds its end for them.
          delegated: true,
          liveChildren: req.liveChildren,
        }
      : {}),
    ...(openWork ? { openWork } : {}),
  };
  return createFinishHook(ports);
}

/**
 * The agent's FINISH module, bound with the Brain's engine ports (`createFinishHook`, the seam the cloud adapter binds in
 * `cloudAdapterHooks.ts`). Until this, `runPrepared` passed no finish module, so the agent ran its port-less default: the
 * sign-off, deliverable and honesty gates, and NO live-children hold. An owner could therefore end its run - in prose or
 * through `finish` - while sub-agents it started were still working, and every report that arrived afterwards woke it into a
 * new run with no ask of its own (chats #60338 and #61651: 16 and more model turns spent in such wake runs).
 *
 * Only the ports the host actually binds are passed: with no `liveChildren` port the module is exactly the default one, so a
 * surface without delegation (the web Brain, the canvas) changes nothing.
 */

import { createFinishHook, type FinishHook, type FinishPorts } from '@builderforce/agent-run';
import type { BrainRunRequest } from '../runStore/runTypes';

/** The finish module for one Brain run. */
export function brainFinishHook(req: Pick<BrainRunRequest, 'liveChildren'>): FinishHook {
  const ports: FinishPorts = req.liveChildren
    ? {
        // The run IS a delegation owner as soon as the host can say who its live children are: an owner, not only a child
        // (`parentRunId`), holds its end for them.
        delegated: true,
        liveChildren: req.liveChildren,
      }
    : {};
  return createFinishHook(ports);
}

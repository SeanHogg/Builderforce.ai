/**
 * The Brain's CONTEXT SOURCE (PRD 35 §3.2 `ContextSource`, §6.10) — the task context pack,
 * built ONCE before turn 1 with no model call.
 *
 * The host's served files are NOT in the pack: the block that showed them whole reaches the model ONCE, as the run's turn
 * context (`runStore/turnContext.ts`), and its reads are the read coverage's from then on (`recordServedReads`). Re-rendering
 * them in every request's tail, uncached, would send the same files again each turn - and stale after an edit. So the pack a
 * run starts from is empty unless the host gathers more (chat state, git state, `codemap:` facts) and passes its own
 * structured pack as `gather`; nothing is read here and a part the host could not gather is simply absent.
 */

import type { ContextPack, ContextSource, RunTask } from '@builderforce/agent-run';

/** The pack a run starts from when its host gathered nothing. */
export const NO_CONTEXT: ContextPack = { focus: [], facts: [], recall: [] };

/** A host's own structured pack, when it builds more than the focus files. */
export type GatherContextPack = (task: RunTask) => Promise<ContextPack | undefined> | ContextPack | undefined;

/** The source of a run: the host's richer `gather` when it has one, else an empty pack. */
export function brainContextSource(gather?: GatherContextPack): ContextSource {
  return {
    async pack(task: RunTask): Promise<ContextPack> {
      return (await gather?.(task)) ?? NO_CONTEXT;
    },
  };
}

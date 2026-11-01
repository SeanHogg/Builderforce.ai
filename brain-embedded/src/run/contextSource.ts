/**
 * The Brain's CONTEXT SOURCE (PRD 35 §3.2 `ContextSource`, §6.10) — the task context pack,
 * built ONCE before turn 1 with no model call.
 *
 * The host's served files are NOT in the pack: the block that showed them whole reaches the model ONCE, as the run's turn
 * context (`runStore/turnContext.ts`), and its reads are the read coverage's from then on (`recordServedReads`). Re-rendering
 * them in every request's tail, uncached, would send the same files again each turn - and stale after an edit. So the pack a
 * run starts from is empty: nothing is read here, and a part no host gathered is simply absent.
 */

import type { ContextPack, ContextSource } from '@builderforce/agent-run';

/** The pack a run starts from when its host gathered nothing. */
const NO_CONTEXT: ContextPack = { focus: [], facts: [], recall: [] };

/** The source of a run: the empty pack. */
export function brainContextSource(): ContextSource {
  return { pack: async (): Promise<ContextPack> => NO_CONTEXT };
}

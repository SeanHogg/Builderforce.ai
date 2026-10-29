/**
 * The Brain's CONTEXT SOURCE (PRD 35 §3.2 `ContextSource`, §6.10) — the task context pack,
 * built ONCE before turn 1 with no model call.
 *
 * The host gathers the pack's parts (the editor: `clients/vscode/src/contextPack`) and the
 * request carries them as `servedReads` (the focus files it showed whole). This is the
 * port over them: nothing is read here, nothing is decided, and a part the host could not
 * gather is simply absent — the pack is best-effort by contract. A host that gathers more
 * (chat state, git state, `codemap:` facts) passes its own structured pack as `gather`.
 */

import type { ContextPack, ContextSource, RunTask } from '@builderforce/agent-run';
import type { BrainRunRequest } from '../runStore/runTypes';

/** The pack a run starts from when its host gathered nothing. */
export const NO_CONTEXT: ContextPack = { focus: [], facts: [], recall: [] };

/** A host's own structured pack, when it builds more than the focus files. */
export type GatherContextPack = (task: RunTask) => Promise<ContextPack | undefined> | ContextPack | undefined;

/** The source over a request: its served focus files, or the host's richer `gather`. */
export function brainContextSource(req: Pick<BrainRunRequest, 'servedReads'>, gather?: GatherContextPack): ContextSource {
  return {
    async pack(task: RunTask): Promise<ContextPack> {
      const gathered = await gather?.(task);
      if (gathered) return gathered;
      const served = (await req.servedReads?.()) ?? [];
      return { ...NO_CONTEXT, focus: served.map((read) => ({ path: read.path, content: read.content })) };
    },
  };
}

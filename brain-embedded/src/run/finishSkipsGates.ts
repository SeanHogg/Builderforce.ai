/**
 * A FINISHING run's report is never sent back by a delivery gate (VS Code chat #128305). The finish contract is "make no more code
 * changes and run nothing … then write the final report" (`runStore/progressGuard.ts`), so the workspace stop hook or a ship /
 * review / pending / delegate / restate gate that would re-prompt the report for more work contradicts it — and on the final turn
 * the model has no tools to do that work with. The run's change stays unshipped and its report says what is left. This leaves ONE
 * trace step, the first time a gate that WOULD have applied was not asked, so triage reads why the run ended unshipped. It is
 * asked from both places a finishing run's answer is taken: a record turn's ladder (`rungs`) and the final turn the ladder never
 * judges (`finalAccepted`).
 */

import { deliveryGates } from '../runStore/deliveryGates';
import { nowIso, pushTrace } from '../runStore/runCells';
import type { BrainRunContext } from '../runStore/brainRunContext';

/** The trace label of the one step a finishing run leaves when it skips the delivery gates. */
export const FINISH_SKIPS_GATES_LABEL = 'loop.finish_skips_delivery_gates';

/**
 * The run is finishing: no gate is asked. Traces the gates that would have applied to `content` (the workspace stop hook's id
 * `stopHookId` among them when `stopHookApplies` says so), once per run (`BrainRunContext.finishSkipNoted`).
 */
export async function noteFinishSkipsGates(
  run: BrainRunContext,
  step: number,
  content: string,
  stopHook: { id: string; applies: () => Promise<boolean> },
): Promise<void> {
  if (run.finishSkipNoted) return;
  const gates = [
    ...((await stopHook.applies()) ? [stopHook.id] : []),
    ...deliveryGates(run).filter((gate) => gate.applies(content)).map((gate) => gate.id),
  ];
  if (gates.length === 0) return;
  run.finishSkipNoted = true;
  // No turn is sent back after this (the rungs are none), so the step is written now rather than held for `sentBack`.
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: FINISH_SKIPS_GATES_LABEL,
    args: { step, gates, files: run.c.touchedFiles.slice(0, 20) },
    result: 'The run is finishing (no more changes, nothing run): the delivery gates that would have sent its report back were not asked — its change stays unshipped and the report says what is left.',
  });
}

/**
 * evermindMergeGate — the held-out regression gate the coordinator's LM merge runs through.
 *
 * The merge itself is the engine's ONE FedAvg (`mergeCheckpointDiffsGated` →
 * `mergeCheckpointDiffs`); what this module owns is the SCORER it is gated on: the
 * project's held-out taught examples, scored with the engine's `meanEvalLoss` over a
 * model reloaded with the checkpoint under test. Before 2026-10-21 the coordinator only
 * RECORDED that pre/post loss as an eval point (the ▲/▼ on the version chip) and
 * published the merge whatever it said; now a merge that raises the held-out loss is
 * refused and the head stays where it was.
 *
 * Unscorable is not a refusal for the LM (the engine's LM default, `requireEval: false`):
 * a project's first merges have no held-out set yet, and a non-LM head has nothing to
 * score — both keep merging exactly as before.
 */
import {
  mergeCheckpointDiffsGated,
  meanEvalLoss,
  type EvalExample,
  type EvalTokenizer,
  type EvermindLM,
  type EvermindModelPackage,
  type GatedMergeResult,
} from '@seanhogg/builderforce-memory-engine';

/** A gated merge plus the model the scorer already loaded with its merged weights. */
export interface GatedEvermindMerge {
  merge: GatedMergeResult;
  /**
   * The model holding the MERGED checkpoint, when scoring had to load it — so the caller
   * repackages from it instead of loading the same weights a second time. Null when the
   * merge was not scored (no held-out set, not an LM) or was refused.
   */
  mergedLM: EvermindLM | null;
}

/**
 * FedAvg `diffs` onto `basePkg`'s checkpoint, refusing the result when its mean held-out
 * loss on `evalSet` is higher than the base's. `isLM` false (or an empty `evalSet`)
 * merges unscored. A scorer that throws counts as unscored — the eval was best-effort
 * before the gate existed, and a broken eval must not wedge learning.
 */
export function gateEvermindMerge(
  basePkg: EvermindModelPackage,
  tokenizer: EvalTokenizer,
  evalSet: readonly EvalExample[],
  diffs: ArrayBuffer[],
  weights: number[],
  isLM: boolean,
): GatedEvermindMerge {
  const scorable = isLM && evalSet.length > 0;
  let mergedLM: EvermindLM | null = null;
  const score = (checkpoint: ArrayBuffer): number | null => {
    if (!scorable) return null;
    try {
      // `loadLM()` is a fresh copy of the BASE weights; the base is scored as loaded.
      const lm = basePkg.loadLM();
      if (checkpoint !== basePkg.checkpoint) {
        lm.loadWeights(checkpoint);
        mergedLM = lm;
      }
      return meanEvalLoss(lm, tokenizer, evalSet);
    } catch {
      return null;
    }
  };
  const merge = mergeCheckpointDiffsGated(basePkg.checkpoint, diffs, weights, score);
  return { merge, mergedLM: merge.accepted ? mergedLM : null };
}

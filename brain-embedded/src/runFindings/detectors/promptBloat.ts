/**
 * `prompt_bloat` — the run paid for far more prompt than it produced: prompt : completion at or above the policy
 * ratio over a large prompt total. `perWrite` is the prompt the run spent per successful write.
 */
import { finding, turnEvidence, writeCalls } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunView } from '../types';

export function promptBloat(view: RunView): RunFinding[] {
  const promptTokens = view.turns.reduce((sum, t) => sum + t.promptTokens, 0);
  const completion = view.turns.reduce((sum, t) => sum + t.completionTokens, 0);
  if (promptTokens < RUN_FINDING_POLICY.promptBloatMinTokens) return [];
  const ratio = completion > 0 ? promptTokens / completion : Number.POSITIVE_INFINITY;
  if (ratio < RUN_FINDING_POLICY.promptBloatRatio) return [];
  const writes = writeCalls(view).length;
  const peak = view.turns.reduce((max, t) => (t.promptTokens > max.promptTokens ? t : max), view.turns[0]!);
  return [finding('prompt_bloat', 'warn', {
    ratio: Number.isFinite(ratio) ? Math.round(ratio) : 0,
    promptTokens,
    perWrite: writes > 0 ? Math.round(promptTokens / writes) : 0,
  }, [turnEvidence(peak)])];
}

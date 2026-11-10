/**
 * `serial_single_writes` — turn after turn that each made exactly one write, every one re-sending the whole prompt.
 * A batched `edit_file` (`edits[]`) or several writes per turn would have cost a fraction.
 */
import { finding, turnEvidence } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunView } from '../types';

export function serialSingleWrites(view: RunView): RunFinding[] {
  const single = view.turns.filter((t) => t.calls.filter((c) => c.write).length === 1);
  if (single.length < RUN_FINDING_POLICY.serialSingleWriteTurns) return [];
  const promptTokens = single.reduce((sum, t) => sum + t.promptTokens, 0);
  return [finding('serial_single_writes', 'warn', { turns: single.length, promptTokens },
    single.map((t) => {
      const write = t.calls.find((c) => c.write)!;
      return { ...turnEvidence(t, write.name), ...(write.paths[0] ? { path: write.paths[0] } : {}) };
    }))];
}

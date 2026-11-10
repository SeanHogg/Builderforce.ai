/**
 * `edit_churn` — one path written again and again: the change was being found by trial, not made. One finding per path.
 */
import { callEvidence, fileLedger, finding } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunView } from '../types';

export function editChurn(view: RunView): RunFinding[] {
  return fileLedger(view)
    .filter((f) => f.writes >= RUN_FINDING_POLICY.editChurnWrites)
    .map((f) => finding('edit_churn', 'warn', { path: f.path, writes: f.writes },
      view.calls.filter((c) => c.paths.includes(f.path)).map((c) => callEvidence(c, f.path))));
}

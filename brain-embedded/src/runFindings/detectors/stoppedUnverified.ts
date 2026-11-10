/**
 * `stopped_unverified` — the user stopped the run (`STOPPED_TURN_STEP` was its last act) while files it wrote were
 * still unchecked: the workspace was left in a state nobody had verified.
 */
import { callEvidence, finding, unverifiedFiles } from '../findingParts';
import { STOPPED_TURN_STEP } from '../../stoppedTurn';
import type { RunFinding, RunView } from '../types';

export function stoppedUnverified(view: RunView): RunFinding[] {
  if (!view.stopped) return [];
  const files = unverifiedFiles(view);
  if (files.length === 0) return [];
  return [finding('stopped_unverified', 'error', { files: files.length }, [
    { step: view.stopped.step, label: STOPPED_TURN_STEP },
    ...files.map((f) => callEvidence(f.lastWrite, f.path)),
  ])];
}

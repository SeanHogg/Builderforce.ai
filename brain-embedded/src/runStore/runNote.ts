/**
 * A host's one-line note on a run's trace — for what the HOST decided about the run as
 * it settled, which the loop could not know (PRD 35 E8: "no facts were written: the
 * chat's Memory switch is off", so diagnostics do not read "0 writes" as a fault).
 * A key with no cell (evicted, never run) is a no-op.
 */

import type { RunKey } from './runTypes';
import { cells, emit, nowIso, pushTrace } from './runCells';

export interface RunNoteStep {
  label: string;
  result: string;
  args?: Record<string, unknown>;
}

export function noteRunStep(key: RunKey, step: RunNoteStep): void {
  const c = cells.get(key);
  if (!c) return;
  pushTrace(c, { ts: nowIso(), category: 'message', label: step.label, ...(step.args ? { args: step.args } : {}), result: step.result });
  emit(c);
}

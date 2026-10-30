import type { RunOutcomeRow } from '@builderforce/agent-run';
import { parseRunOutcomeTelemetry, wireCost, type RunOutcomeRequest, type TerminalStatus } from '@builderforce/learned-routing';

/**
 * A settled canvas run's uniform outcome row (PRD 35 §8.2, `entryPoint: 'canvas'`) as the
 * request the one write-back door takes (`POST /llm/v1/run-outcome`). PURE: no network, no
 * session. The run hands the row to the host's `onOutcome` port; the canvas host builds this
 * request and sends it through the typed API client (`brainTurn/canvasOutcomeReporter.ts`).
 *
 * The row's fields ARE the wire's (`parseRunOutcomeTelemetry` is the contract's own
 * validator, so nothing is renamed on the way and a field the door would drop is dropped
 * here). `routingSignal: false` — a canvas turn is not evidence about CODING models, so the
 * door records the row and never folds it into (or rebuilds it into) the routing ranking.
 */

/** How the run ended, in the door's words. A Stop is `cancelled`, not a failure. */
export function canvasTerminalStatus(row: RunOutcomeRow, stopped: boolean): TerminalStatus {
  if (stopped) return 'cancelled';
  return row.terminalStatus === 'finished' ? 'completed' : 'failed';
}

/** Null when the run has nothing to attribute (no model ever answered). */
export function canvasOutcomeRequest(
  row: RunOutcomeRow,
  run: { clientRunId: string; stopped: boolean; projectId?: number | null },
): RunOutcomeRequest | null {
  const model = row.model?.trim();
  if (!model) return null;
  return {
    ...parseRunOutcomeTelemetry({ ...row }),
    ...wireCost(row),
    clientRunId: run.clientRunId,
    model,
    source: 'canvas',
    terminalStatus: canvasTerminalStatus(row, run.stopped),
    steps: row.steps,
    // The row says the TENANT ran out of quota (`buildOutcomeRow` classified it once): the door stores it and never teaches it.
    ...(row.quotaExhausted ? { quotaExhausted: true } : {}),
    ...(run.projectId != null ? { projectId: run.projectId } : {}),
    routingSignal: false,
  };
}

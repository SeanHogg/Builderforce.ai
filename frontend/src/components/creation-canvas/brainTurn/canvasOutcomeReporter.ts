import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { RunOutcomeRow } from '@builderforce/agent-run';
import { learnedRoutingApi } from '@/lib/learnedRoutingApi';
import { getStoredTenantToken } from '@/lib/auth';
import { webInferenceModeNow } from '@/lib/localFirst/webInferenceMode';
import { canvasOutcomeRequest } from '@/lib/canvasRunOutcome';

/**
 * The canvas HOST's `onOutcome` port: a settled canvas run's PRD 35 §8.2 uniform row goes to
 * the one write-back door (`POST /llm/v1/run-outcome`) through the typed API client. The run
 * library (`creationCanvasAi`) only hands the row over — it does no network I/O.
 *
 * This is AMBIENT telemetry. It is skipped — with a trace line, never an error — when the
 * board is a guest's (no tenant session to report under), when there is no tenant token, or
 * when the inference mode is Local only (a device that chose to keep a turn on itself sends
 * nothing about it). A report that cannot be sent is the same non-error trace line, and the
 * client treats the door's refusals as expected (`AMBIENT_REQUEST_ERRORS`).
 */
export function canvasOutcomeReporter(turn: {
  persistence: 'local' | 'server';
  /** The transcript id of the request. */
  requestMessageId: string;
  /** Which run of that request this is (a composer submit runs several: each specialist, then Brain). */
  runKey: string;
  projectId?: number | null;
  signal: AbortSignal;
  trace: (event: BrainTraceEvent) => void;
}): (row: RunOutcomeRow) => void {
  const note = (result: string): void => turn.trace({ ts: new Date().toISOString(), category: 'message', label: 'run outcome not reported', result });
  return (row) => {
    if (turn.persistence !== 'server') return note('a guest board has no session to report under');
    if (!getStoredTenantToken()) return note('there is no signed-in session');
    if (webInferenceModeNow() === 'local-only') return note('inference is Local only');
    const body = canvasOutcomeRequest(row, {
      // Derived from the run, never minted: the same run reports under the same id, so a retry is idempotent.
      clientRunId: `canvas:${turn.requestMessageId}:${turn.runKey}`,
      stopped: turn.signal.aborted,
      projectId: turn.projectId ?? null,
    });
    if (!body) return note('no model answered the run');
    learnedRoutingApi.reportRunOutcome(body).catch((error: unknown) => note(error instanceof Error ? error.message : String(error)));
  };
}

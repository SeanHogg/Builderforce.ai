import type { BrainRunOutcome } from '@seanhogg/builderforce-brain-embedded';
import type { RunOutcomeRequest } from '@builderforce/learned-routing';
import { learnedRoutingApi } from '@/lib/learnedRoutingApi';
import { getStoredTenantToken } from '@/lib/auth';
import { webInferenceModeNow } from '@/lib/localFirst/webInferenceMode';

/**
 * The web Brain's report port, for both reports a settled run can make (PRD 35 §8.2): the coder's grade (with the agent's telemetry riding on
 * it) and the uniform record of a run with no grade (recorded, never taught) goes to the one write-back door (`POST /llm/v1/run-outcome`)
 * through the typed API client. The run does no network I/O of its own; this is the host's.
 *
 * AMBIENT telemetry, like the canvas's: nothing is sent when there is no signed-in tenant session, or when the person keeps inference
 * Local only (a device that chose to keep a turn on itself sends nothing about it). A report that cannot be sent is not an error to the person:
 * it is not swallowed here either, it rejects to the run store, which owns the call and records it in the run's own trace
 * (`run.outcome_unrecorded`) without ever holding the run open or failing it - the same as the Rovr and VS Code ports.
 */
export async function reportWebRunOutcome(outcome: BrainRunOutcome | RunOutcomeRequest): Promise<void> {
  if (!getStoredTenantToken()) return;
  if (webInferenceModeNow() === 'local-only') return;
  await learnedRoutingApi.reportRunOutcome(outcome as RunOutcomeRequest);
}

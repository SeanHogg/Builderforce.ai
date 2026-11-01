import type { BrainRunReport } from '@seanhogg/builderforce-brain-embedded';
import type { RunOutcomeRequest } from '@builderforce/learned-routing';
import { learnedRoutingApi } from '@/lib/learnedRoutingApi';
import { getStoredTenantToken } from '@/lib/auth';
import { webInferenceModeNow } from '@/lib/localFirst/webInferenceMode';

/**
 * The web Brain's report port: a settled run's outcome record (PRD 35 §8.2 - the agent's uniform row merged into the coder's grade, or
 * the row alone, recorded and never taught, when the run made no grade) goes to the one write-back door (`POST /llm/v1/run-outcome`)
 * through the typed API client. The run does no network I/O of its own; this is the host's.
 *
 * AMBIENT telemetry, like the canvas's: nothing is sent when there is no signed-in tenant session, or when the person keeps inference
 * Local only (a device that chose to keep a turn on itself sends nothing about it). A report that cannot be sent is not an error.
 */
export async function reportWebRunOutcome(outcome: BrainRunReport): Promise<void> {
  if (!getStoredTenantToken()) return;
  if (webInferenceModeNow() === 'local-only') return;
  await learnedRoutingApi.reportRunOutcome(outcome as RunOutcomeRequest).catch(() => undefined);
}

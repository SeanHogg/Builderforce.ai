/**
 * cloudShipGate — the cloud run's half of the publish refusal (PRD 48 §4.2).
 *
 * A cloud run's ship policy is always `pull_request`: it opens its PR and ends, and the PR merge sweep merges by the project's
 * settings. The refusal itself (every raw shell push, pull request or merge through the sandbox's `run_command`, refused BEFORE it
 * dispatches, categorically) is the agent's (`@builderforce/agent-run` `policy/guards/shipGate.ts`, over `publishAllowed` in
 * `@builderforce/run-guards`). This surface supplies only the run's policy and where a refusal is recorded; only the MODEL's calls
 * are judged, so the platform's own branch push (finalize, the early draft) is never refused.
 */
import type { PublishGatePort } from '@builderforce/agent-run';
import type { ShipPolicy } from '@builderforce/run-guards';

/** The `SurfacePorts.publishGate` for a run. No policy ⇒ no gate. */
export function cloudPublishGate(
  ship: ShipPolicy | undefined,
  onRefused: (tool: string, error: string) => Promise<void> | void,
): PublishGatePort | undefined {
  return ship ? { policy: ship, onRefused } : undefined;
}

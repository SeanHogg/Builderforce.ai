/**
 * cloudTickPayload — what a durable tick reads off the run's dispatch payload (extracted from `CloudRunnerDO`).
 *
 * Re-parsed every tick on purpose: these are DATA the board compiled at dispatch (the sign-off a reviewer run owes, the
 * originating chat, the routing bias, the arc stage, the governance gates, a sub-agent's spec), immutable for the run, cheap to
 * read, and the cursor already carries the payload — keeping a second copy in the resume state could only drift from it.
 */
import type { ArcStage } from '@builderforce/workload';
import type { PolicyGate } from '@builderforce/agent-tools';
import { parseRoutingBias, parseArcStage, parsePolicyGates, parseReviewRole, parseLaneKey, parseOriginatingChatId } from './cloudDispatch';
import { parseCloudChild, type CloudChildSpec } from './cloudChildRuns';
import type { RequiredReviewSignoff } from './cloudAgent/finishGates';

export interface CloudTickPayload {
  requiredSignoff?: RequiredReviewSignoff;
  originatingChatId?: number;
  routingBias?: Record<string, number>;
  arcStage?: ArcStage;
  policyGates: PolicyGate[];
  /** A sub-agent's spec; absent for a top-level run. */
  child: CloudChildSpec | null;
}

export function parseCloudTickPayload(payload: string | null | undefined): CloudTickPayload {
  const reviewRole = parseReviewRole(payload ?? undefined);
  const reviewLane = parseLaneKey(payload ?? undefined);
  const originatingChatId = parseOriginatingChatId(payload ?? undefined);
  const routingBias = parseRoutingBias(payload ?? undefined);
  const arcStage = parseArcStage(payload ?? undefined);
  return {
    ...(reviewRole ? { requiredSignoff: { roleKey: reviewRole, ...(reviewLane ? { laneKey: reviewLane } : {}) } } : {}),
    ...(originatingChatId != null ? { originatingChatId } : {}),
    ...(routingBias ? { routingBias } : {}),
    ...(arcStage ? { arcStage } : {}),
    policyGates: parsePolicyGates(payload ?? undefined),
    child: parseCloudChild(payload),
  };
}

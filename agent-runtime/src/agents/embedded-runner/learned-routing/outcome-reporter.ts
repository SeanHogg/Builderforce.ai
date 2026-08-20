/**
 * Learned Model Routing (PRD 13) — the host's WRITE-BACK.
 *
 * `POST /llm/v1/run-outcome` is the door a non-cloud run uses to teach the same
 * routing table cloud runs teach. Without it, every self-hosted and IDE-native run is
 * invisible to the learner: the fleet's ranking is then built only from work that
 * happened in the cloud, and an on-prem host seeds from a table its own experience
 * never contributed to.
 *
 * The body is built through the SHARED contract (`RunOutcomeRequest` in
 * `@builderforce/learned-routing`) — the same module the route parses with — so the
 * two halves of the door cannot drift on a field name.
 *
 * FIRE-AND-FORGET by contract. Reporting an outcome is bookkeeping about a run that
 * has already finished; it must never be able to fail one. Every failure path here
 * ends in a logged warning and a resolved promise.
 */

import {
  RUN_OUTCOME_PATH,
  type ActionType,
  type RunOutcomeRequest,
  type TerminalStatus,
} from "@builderforce/learned-routing";
import { logDebug, logWarn } from "../../../logger.js";
import { learnedRoutingOn, resolveGatewayLink, resolveProjectId } from "./settings.js";

const REPORT_TIMEOUT_MS = 10_000;

/** `client_run_id` is partial-UNIQUE across the whole table, not per tenant, so the
 *  host's own run id is namespaced before it becomes one. Also the column's length. */
const CLIENT_RUN_ID_PREFIX = "onprem:";
const CLIENT_RUN_ID_MAX = 128;

/** Namespace this host's run id into the api's global idempotency key space. PURE. */
export function clientRunIdFor(runId: string): string {
  return `${CLIENT_RUN_ID_PREFIX}${runId.trim()}`.slice(0, CLIENT_RUN_ID_MAX);
}

export interface RunOutcomeFacts {
  /** This host's id for the run — the idempotency key, namespaced by
   *  {@link clientRunIdFor}. The SAME run reported twice folds in once. */
  runId: string;
  /** The model the run actually LOCKED ONTO, not the one it was seeded with — after
   *  failover those differ, and crediting the seed for the fallback's work is exactly
   *  the mislabel the ledger exists to avoid. */
  model: string;
  actionType: ActionType;
  terminalStatus: TerminalStatus;
  /** The run died on a provider rate limit — an AVAILABILITY signal, kept beside the
   *  quality score so a throttled model is demoted without being called bad. */
  rateLimited?: boolean;
  /** The run degraded off its intended model/provider (a failover happened). */
  degraded?: boolean;
  /** LLM calls the run made. Feeds the efficiency half of the outcome score. */
  steps?: number;
  projectId?: number;
}

/**
 * Build the exact body the route parses. Split out from the POST so the payload SHAPE
 * is unit-testable without a network, and so every field name is spelled once, here,
 * against the shared contract type. PURE.
 *
 * `source` is always `'onprem'`: this is the self-hosted engine, and the api uses the
 * source to tell the learner which population an outcome came from. `merged`,
 * `ciGreen` and `approved` are deliberately NOT sent — an embedded run has no pull
 * request, no CI and no approval, and sending `false` would score it as a run that
 * FAILED those gates rather than one they never applied to.
 */
export function buildRunOutcomeReport(facts: RunOutcomeFacts): RunOutcomeRequest {
  const projectId = resolveProjectId(facts.projectId);
  return {
    clientRunId: clientRunIdFor(facts.runId),
    source: "onprem",
    model: facts.model,
    terminalStatus: facts.terminalStatus,
    actionType: facts.actionType,
    ...(projectId != null ? { projectId } : {}),
    ...(facts.steps != null ? { steps: Math.max(0, Math.floor(facts.steps)) } : {}),
    ...(facts.degraded != null ? { degraded: facts.degraded } : {}),
    ...(facts.rateLimited != null ? { rateLimited: facts.rateLimited } : {}),
  };
}

/**
 * Report one terminal outcome. Resolves once the POST has been attempted; the caller
 * may `void` it. No-ops (never throws) when the feature is off or this host is not
 * linked to a Builderforce workspace.
 *
 * Returns whether the report was accepted — for tests and diagnostics, not for
 * control flow.
 */
export async function reportRunOutcome(report: RunOutcomeRequest): Promise<boolean> {
  if (!learnedRoutingOn()) {
    return false;
  }
  // `clientRunId` is the api's idempotency key: the SAME run reported twice folds into
  // the learned table once. Without one there is nothing to deduplicate on, and the
  // route would reject the body anyway.
  if (!report.clientRunId?.trim() || !report.model?.trim()) {
    logDebug("[learned-routing] outcome report skipped: no clientRunId or model");
    return false;
  }
  const link = resolveGatewayLink();
  if (!link) {
    return false;
  }

  try {
    const res = await fetch(`${link.base}${RUN_OUTCOME_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${link.apiKey}`,
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    if (!res.ok) {
      logWarn(`[learned-routing] run-outcome report returned HTTP ${res.status}`);
      return false;
    }
    logDebug(
      `[learned-routing] reported ${report.terminalStatus ?? "completed"} run=${report.clientRunId} model=${report.model} action=${report.actionType ?? "other"}`,
    );
    return true;
  } catch (err) {
    logWarn(`[learned-routing] run-outcome report failed: ${String(err)}`);
    return false;
  }
}

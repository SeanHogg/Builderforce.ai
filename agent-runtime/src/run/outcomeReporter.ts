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

import type { RunOutcomeRow } from "@builderforce/agent-run";
import {
  DEFAULT_ACTION_TYPE,
  RUN_OUTCOME_PATH,
  parseRunOutcomeTelemetry,
  type ActionType,
  type RunOutcomeRequest,
  type TerminalStatus,
} from "@builderforce/learned-routing";
import { learnedRoutingOn, resolveGatewayLink, resolveProjectId } from "../agents/embedded-runner/learned-routing/settings.js";
import { logDebug, logWarn } from "../logger.js";

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

/** Where a run belongs, when the host knows more than its environment does. */
export interface OutcomeScope {
  projectId?: number;
  taskId?: number;
}

/**
 * What EVERY report from this host carries, whichever reporter built it: the run's namespaced key,
 * the `'onprem'` source, and the project (the explicit one, else this host's configured one) and
 * ticket it belongs to. ONE place, so the two builders cannot drift on how a run is keyed or scoped.
 */
function reportEnvelope(runId: string, scope: OutcomeScope = {}) {
  const projectId = resolveProjectId(scope.projectId);
  return {
    clientRunId: clientRunIdFor(runId),
    source: "onprem" as const,
    ...(projectId != null ? { projectId } : {}),
    ...(scope.taskId != null ? { taskId: scope.taskId } : {}),
  };
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
  return {
    ...reportEnvelope(facts.runId, { projectId: facts.projectId }),
    model: facts.model,
    terminalStatus: facts.terminalStatus,
    actionType: facts.actionType,
    ...(facts.steps != null ? { steps: Math.max(0, Math.floor(facts.steps)) } : {}),
    ...(facts.degraded != null ? { degraded: facts.degraded } : {}),
    ...(facts.rateLimited != null ? { rateLimited: facts.rateLimited } : {}),
  };
}

/**
 * The body for the PRD 35 §8.2 uniform row the ONE agent (`runAgent`) writes at the end of a run -
 * the on-prem entry point's report to the fleet. The row's field names ARE the wire's, so the
 * telemetry half goes through the shared validator (a malformed counter is a missing fact, never a
 * rejected report). The row's run id and its owner's go through {@link clientRunIdFor} TOGETHER, so a
 * sub-agent's `parentRunId` is the `clientRunId` its owner's row was reported under and the pointer
 * joins. Null when the row cannot be keyed or attributed (no run id, no model): nothing to report.
 * PURE.
 */
export function buildRunRowReport(row: RunOutcomeRow, scope: OutcomeScope = {}): RunOutcomeRequest | null {
  const runId = row.runId?.trim();
  const model = row.model?.trim();
  if (!runId || !model) return null;
  return {
    ...parseRunOutcomeTelemetry({ ...row, parentRunId: row.parentRunId ? clientRunIdFor(row.parentRunId) : undefined }),
    ...reportEnvelope(runId, scope),
    model,
    // A Stop is not a failure of the work: it scores as cancelled, never as a bad run.
    terminalStatus: row.cancelled ? "cancelled" : row.terminalStatus === "finished" ? "completed" : "failed",
    actionType: DEFAULT_ACTION_TYPE,
    steps: Math.max(0, Math.floor(row.steps)),
    ...(row.cost !== undefined ? { costMc: Math.max(0, Math.floor(row.cost)) } : {}),
    // Availability and degradation are kept beside the score (never folded into it): a throttled model
    // is demoted without being called bad, and a run served off its model does not earn full credit.
    ...(row.rateLimited ? { rateLimited: true } : {}),
    ...(row.degraded ? { degraded: true } : {}),
  };
}

/** Report the §8.2 row a run ended with, fire-and-forget (see {@link reportRunOutcome}). */
export function reportRunRow(row: RunOutcomeRow, scope: OutcomeScope = {}): void {
  const report = buildRunRowReport(row, scope);
  if (report) void reportRunOutcome(report);
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

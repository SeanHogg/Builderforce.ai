/**
 * telemetry/runOutcomeRequest — a run's uniform outcome row (§8.2) as the request the one write-back door takes
 * (`POST /llm/v1/run-outcome`, the contract in `@builderforce/learned-routing`).
 *
 * ONE builder for every client that reports a row: the on-prem host, the Creation Canvas, and the Brain's hosts (VS Code, web and
 * Rovr). The row's fields ARE the wire's (`parseRunOutcomeTelemetry` is the contract's own validator, so nothing is renamed on the way
 * and a field the door would drop is dropped here); what a host adds is only its run's key and scope. PURE: no network, no session, no
 * `node:*`.
 */

import {
  parseRunOutcomeTelemetry,
  wireCost,
  type OutcomeSource,
  type RunOutcomeRequest,
  type TerminalStatus,
} from "@builderforce/learned-routing";
import type { RunOutcomeRow } from "./rowType.js";

/** What a host knows about the run that the row does not. */
export interface RunOutcomeScope {
  /** The run's idempotency key: ONE outcome per id, so a retry folds in once. */
  clientRunId: string;
  /** The person pressed Stop (a host that knows it beyond the row's own `cancelled`). */
  stopped?: boolean;
  projectId?: number | null;
  taskId?: number;
  /** The key the owner's row was reported under, when this run is a sub-agent's. */
  parentClientRunId?: string;
  /** The kind of work, when the host classifies it. */
  actionType?: string;
  /** `false` for a run that is no evidence about CODING models (a canvas turn): the door records the row and never teaches routing. */
  routingSignal?: boolean;
}

/** Which population the door files an entry point's runs under. */
export function outcomeSourceOf(entryPoint: RunOutcomeRow["entryPoint"]): OutcomeSource {
  switch (entryPoint) {
    case "on-prem":
      return "onprem";
    case "vscode":
      return "ide";
    case "canvas":
      return "canvas";
    case "cloud":
      return "cloud";
    default:
      return "external";
  }
}

/** How the run ended, in the door's words. A Stop is `cancelled`, never a failure of the work. */
export function outcomeTerminalStatus(row: RunOutcomeRow, stopped = false): TerminalStatus {
  if (stopped || row.cancelled) return "cancelled";
  return row.terminalStatus === "finished" ? "completed" : "failed";
}

/** Null when the run has nothing to attribute (no model ever answered). */
export function runOutcomeRequestOf(row: RunOutcomeRow, scope: RunOutcomeScope): RunOutcomeRequest | null {
  const model = row.model?.trim();
  if (!model || !scope.clientRunId.trim()) return null;
  return {
    ...parseRunOutcomeTelemetry({ ...row, ...(scope.parentClientRunId ? { parentRunId: scope.parentClientRunId } : {}) }),
    ...wireCost(row),
    clientRunId: scope.clientRunId,
    model,
    source: outcomeSourceOf(row.entryPoint),
    terminalStatus: outcomeTerminalStatus(row, scope.stopped),
    steps: Math.max(0, Math.floor(row.steps)),
    // The row says the TENANT ran out of quota (`buildOutcomeRow` classified it once): the door stores it and never teaches it.
    ...(row.quotaExhausted ? { quotaExhausted: true } : {}),
    // Availability and degradation are kept beside the score, never folded into it: a throttled model is demoted without being called
    // bad, and a run served off its model does not earn full credit.
    ...(row.rateLimited ? { rateLimited: true } : {}),
    ...(row.degraded ? { degraded: true } : {}),
    ...(scope.projectId != null ? { projectId: scope.projectId } : {}),
    ...(scope.taskId != null ? { taskId: scope.taskId } : {}),
    ...(scope.actionType ? { actionType: scope.actionType } : {}),
    ...(scope.routingSignal === false ? { routingSignal: false } : {}),
  };
}

/**
 * Learned Model Routing (PRD 13) — the RUN-OUTCOME write-back contract.
 *
 * `POST /llm/v1/run-outcome` is the door a NON-cloud run (on-prem host, IDE-native,
 * external SDK) uses to teach the same routing table that cloud runs teach. Both
 * halves of that door live here so they can never drift:
 *
 *   • the CLIENT builds a {@link RunOutcomeRequest} — it is the only place field
 *     names are spelled, so an on-prem host cannot invent `status` where the route
 *     reads `terminalStatus`;
 *   • the ROUTE hands the raw JSON body to {@link parseRunOutcomeRequest}, which
 *     validates and normalizes it into the {@link NormalizedRunOutcome} the scorer
 *     records.
 *
 * Pure and dependency-free: no env, no fetch, no DB. The transport (base URL,
 * bearer, retries) belongs to whoever calls it.
 */

/** How a run ended. Non-'completed' scores 0 (see the api's `computeOutcomeScore`). */
export type TerminalStatus = 'completed' | 'failed' | 'cancelled';

/** Where the run executed. Anything non-'cloud' has no `executions` row. */
export type OutcomeSource = 'cloud' | 'onprem' | 'ide' | 'external';

/** Path of the write-back door, relative to the gateway base. */
export const RUN_OUTCOME_PATH = '/llm/v1/run-outcome';

/** Path of the client-facing READ of the learned ranking, relative to the gateway
 *  base. Takes `?scope=<scopeToken>` (see `routingScope.ts`). */
export const MODEL_ANALYTICS_PATH = '/llm/v1/model-analytics';

/**
 * The JSON body a client POSTs. `terminalStatus` wins; `success` is a friendly
 * boolean alias for callers that only know "did it work".
 */
export interface RunOutcomeRequest {
  /** Idempotency key — ONE outcome per id. The client's own execution/run id. */
  clientRunId: string;
  /** The model the run actually used (what it locked onto, not what it asked for). */
  model: string;
  source?: OutcomeSource;
  terminalStatus?: TerminalStatus;
  /** Alias for `terminalStatus`: true → completed, false → failed. */
  success?: boolean;
  actionType?: string;
  projectId?: number | null;
  taskId?: number | null;
  merged?: boolean;
  ciGreen?: boolean;
  degraded?: boolean;
  steps?: number;
  costMc?: number;
  approved?: boolean;
  /** The run died on a provider rate limit — an AVAILABILITY signal that demotes the
   *  model without teaching the router it is low-quality. */
  rateLimited?: boolean;
}

/** A validated, fully-resolved outcome — what the scorer records. */
export interface NormalizedRunOutcome {
  clientRunId: string;
  source: OutcomeSource;
  model: string;
  terminalStatus: TerminalStatus;
  actionType?: string;
  projectId?: number | null;
  taskId?: number | null;
  merged?: boolean;
  ciGreen?: boolean;
  degraded?: boolean;
  steps?: number;
  costMc?: number;
  approved?: boolean;
  rateLimited?: boolean;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Validate + normalize a raw request body. `clientRunId` and `model` are the only
 * required fields (without them there is nothing to key on and nothing to attribute);
 * everything else degrades to a conservative default rather than rejecting a report
 * a client took the trouble to send. PURE.
 */
export function parseRunOutcomeRequest(
  body: unknown,
): { ok: true; outcome: NormalizedRunOutcome } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const clientRunId = str(b.clientRunId);
  const model = str(b.model);
  if (!clientRunId || !model) return { ok: false, error: 'clientRunId and model are required' };

  const terminalStatus: TerminalStatus =
    b.terminalStatus === 'completed' || b.terminalStatus === 'failed' || b.terminalStatus === 'cancelled'
      ? b.terminalStatus
      : b.success === true
        ? 'completed'
        : b.success === false
          ? 'failed'
          : 'completed';
  // 'cloud' is deliberately NOT accepted off the wire: a cloud run has an executions
  // row and is scored server-side, so a client claiming to be one would double-count.
  const source: OutcomeSource =
    b.source === 'onprem' || b.source === 'ide' || b.source === 'external' ? b.source : 'external';

  const projectId = num(b.projectId);
  const taskId = num(b.taskId);
  const merged = bool(b.merged);
  const ciGreen = bool(b.ciGreen);
  const degraded = bool(b.degraded);
  const steps = num(b.steps);
  const costMc = num(b.costMc);
  const approved = bool(b.approved);
  const rateLimited = bool(b.rateLimited);
  const actionType = str(b.actionType);

  return {
    ok: true,
    outcome: {
      clientRunId,
      source,
      model,
      terminalStatus,
      ...(actionType ? { actionType } : {}),
      ...(projectId != null ? { projectId } : {}),
      ...(taskId != null ? { taskId } : {}),
      ...(merged != null ? { merged } : {}),
      ...(ciGreen != null ? { ciGreen } : {}),
      ...(degraded != null ? { degraded } : {}),
      ...(steps != null ? { steps } : {}),
      ...(costMc != null ? { costMc } : {}),
      ...(approved != null ? { approved } : {}),
      ...(rateLimited != null ? { rateLimited } : {}),
    },
  };
}

/**
 * telemetry/rowType — the shape of the uniform outcome row (PRD 35 §8.2).
 *
 * Split out of `contract.ts` (which re-exports it) so the contract stays under the module
 * size limit; WS6 owns the row and the fields it adds.
 */

/** The uniform outcome row (§8.2): ONE per run, every entry point, built by `telemetry/outcomeRow`
 *  when the run ends. `entryPoint` is a telemetry label — never a behaviour branch (§5 rule 3). */
export interface RunOutcomeRow {
  entryPoint: string;
  runId?: string;
  /** Set on a SUB-AGENT's row: the run that spawned it (`RunTask.dispatch.parentRunId`), so a child is never counted as a second run of its owner. */
  parentRunId?: string;
  steps: number;
  toolCalls: number;
  toolErrors: number;
  /** How many times the transcript was compacted this run. */
  compactions: number;
  /** How many stall recoveries the run's model policy performed. */
  stallRecoveries: number;
  /** How many times the run escalated (a forced-progress / stronger-model step). */
  escalations: number;
  /** The declared verify phase's result. */
  verify: 'passed' | 'failed' | 'not-run';
  terminalStatus: string;
  model?: string;
  tokens?: number;
  cacheReadTokens?: number;
  cost?: number;                   // millicents, summed from what the transport reported
  // ── §8.2 efficiency fields ────────────────────────────────────────────────
  /** The turn the first spawn happened on; null when nothing was spawned. */
  firstSpawnTurn?: number | null;
  /** How many covered reads were stubbed (a window already served, re-served). */
  coveredReadStubs?: number;
  /** `cat`/`sed`/`head`/`tail` of a workspace file through the shell. */
  shellFileReads?: number;
  /** Calls that errored with "not a repo". */
  repoErrors?: number;
  /** Tokens the context pack contributed. */
  contextPackTokens?: number;
  /** The model preflight result: ok | refreshed | degraded:<reason>. */
  modelPreflight?: string;
  /** Turns that claimed readiness then only read (WS8p `unkept_ready`). */
  unkeptReadyClaims?: number;
  /** The A3 progress trips, by signal ({ signal: count }). */
  progressTrips?: Record<string, number>;
  /** Present (true) only when the run was STOPPED (a user Stop, a steered stop, a cancelled owner) - not a failure of the work. */
  cancelled?: boolean;
  /** Present (true) only when the run died on a provider rate limit - an availability signal, not a quality one. */
  rateLimited?: boolean;
  /** Present (true) only when the run failed because the TENANT ran out of quota/budget - not evidence about the model, so routing never learns from it. NOT a run stopping at its own per-run cap. */
  quotaExhausted?: boolean;
  /** Present (true) only when the run was served by a WEAKER model than it asked for (a recorded downgrade). A failover onto a model of the same standing (or one the price book cannot rank), and a preflight note, are not recorded as a downgrade. */
  degraded?: boolean;
}

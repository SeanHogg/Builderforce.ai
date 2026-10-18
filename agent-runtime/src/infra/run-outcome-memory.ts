/**
 * run-outcome-memory — the on-prem mirror of the cloud run's memory commit.
 *
 * A cloud run ends by calling `commitRunMemory` (api/src/application/runtime/
 * cloudAgent/runEndMemory.ts): it writes what the run learned into the governed
 * memory store under a stable `run-outcome:<scope>:<id>` key, tagged
 * `run-outcome`. The embedded runner could not copy that call in-process — it
 * holds no `Db` and no `Env`, which is exactly why the cloud twin is
 * unreachable from here — so this module reaches the SAME durable store over
 * HTTP instead, through the door the runtime already authenticates on
 * (`Authorization: Bearer` + `X-AgentHost-Id`, the pair every other
 * agent-runtime → api caller uses).
 *
 * WHY THE FACTS DOOR AND NOT /api/teams/memory: both routes are host-authed and
 * both land in `memoryService.remember`, but only the project-facts door lets
 * the CALLER supply the memory key. `teamMemoryRoutes` (api/src/presentation/
 * routes/teamMemoryRoutes.ts) computes its own — `teamMemoryKey(agentHostId,
 * runId)` — so a run-outcome posted there would be filed under a mesh key, not
 * `run-outcome:<scope>:<id>`, and would not be the same KIND of fact a cloud
 * run writes. Mirroring the key is the point of this module, so it takes the
 * facts door (`pushProjectFact`, the same helper the per-file write-through
 * beliefs already use).
 *
 * NOT the verify half of the seam: `commitRunMemory` lives beside
 * `runVerifyPhase`, and the verify phase is deliberately NOT mirrored. The
 * embedded runner has no verify step of its own — it runs the agent's own tool
 * loop and has no declared check to select — so emitting the run policy's
 * `verify_started` here would be a claim about a step that never happened. The
 * cloud twin guards exactly this (`runVerifyPhase` degrades an on-prem caller to
 * the durable surface). The verify note therefore stays absent rather than
 * invented.
 *
 * BEST-EFFORT BY CONTRACT. A run that finished is a finished run: this never
 * throws, never rejects, and never blocks the run that called it. A memory
 * failure is observable at debug level and nothing more.
 */
import { logDebug } from "../logger.js";
import { pushProjectFact } from "./project-facts-sync.js";
import type { ProjectFactsSyncConfig } from "./project-facts-sync.js";

/** Credentials + target for one host's write to the shared memory store. */
export type RunOutcomeMemoryConfig = ProjectFactsSyncConfig;

/** Facts below this length are noise; a "learning" of four words teaches nothing.
 *  The same floor `commitRunMemory` applies (MIN_COMMIT_BODY there). */
const MIN_COMMIT_BODY = 24;

/** How many written paths one fact will name, matching the cloud twin's slice. */
const MAX_PATHS = 25;

export interface RunOutcomeMemoryInput {
  /** What the run DID — its own summary of the work, the fact the next run needs. */
  summary: string;
  /** The files the run wrote, so the fact points at them. */
  writtenPaths?: readonly string[];
  /** An extra fact worth keeping (an in-run failure worth not repeating). */
  learning?: string;
  /** Extra tags, appended after `run-outcome` exactly as the cloud twin does. */
  tags?: readonly string[];
  /**
   * Identifies the run in the key. A cloud run uses its execution id; an on-prem
   * run has no execution row, so its run id plays that part. Pass the value
   * through unchanged — the caller owns it and the key stays stable per run.
   */
  runId?: string;
}

/**
 * The memory key a cloud run's `commitRunMemory` would have written for this
 * run: `run-outcome:<scope>:<id>`. Scoped to the project because that is the
 * scope the facts door serves; a cloud run with a ticket narrows to
 * `ticket-<id>`, which an on-prem run cannot claim — it has no ticket row, and
 * a fabricated one would be a fact about a run that never existed.
 *
 * Mirrors the cloud twin's boundedness: the id is truncated so a runaway
 * caller cannot push the key past a storage limit.
 */
export function runOutcomeFactKey(cfg: RunOutcomeMemoryConfig, runId: string): string {
  const id = runId.trim().slice(0, 120);
  return `run-outcome:project-${cfg.projectId}:${id || "run"}`;
}

/**
 * Build the fact body: the cloud twin joins `[body, verifyNote?, "changed: …"]`
 * with newlines. On-prem has no verify note (see the header), so the changed
 * paths line carries the same information the next run needs from it.
 */
export function buildRunOutcomeFact(input: RunOutcomeMemoryInput): string {
  const body = input.learning?.trim() || input.summary.trim();
  const paths = (input.writtenPaths ?? [])
    .filter((p) => typeof p === "string" && !!p.trim())
    .slice(0, MAX_PATHS);
  const parts = [body];
  if (paths.length > 0) {
    parts.push(`changed: ${paths.join(", ")}`);
  }
  return parts.join("\n");
}

/**
 * Commit what an on-prem run learned to the shared memory store, as the same
 * KIND of fact a cloud run commits.
 *
 * Returns whether the write landed, so a caller can log that — and never lets
 * `false` fail or delay its run. No-ops (rather than throwing) when this host
 * has no project id to write into: there is no project store to reach, and the
 * run still finished.
 */
export async function commitRunOutcomeMemory(
  cfg: RunOutcomeMemoryConfig | null,
  input: RunOutcomeMemoryInput,
): Promise<boolean> {
  // No project → no facts door. Skip cleanly; the run is not ours to fail.
  if (!cfg || !Number.isFinite(cfg.projectId) || cfg.projectId <= 0) {
    return false;
  }

  const key = runOutcomeFactKey(cfg, input.runId ?? "");
  const content = buildRunOutcomeFact(input);
  if (content.length < MIN_COMMIT_BODY) {
    return false;
  }

  // Tags are part of the cloud twin's contract but the facts door stores no tag
  // column (RememberFactBody takes key/content/source only), so `run-outcome`
  // rides on the key instead — a fact is findable by its key either way.
  try {
    const stored = await pushProjectFact(cfg, key, content);
    if (!stored) logDebug(`[run-outcome-memory] write did not land for ${key}`);
    return stored;
  } catch (err) {
    // Best-effort by contract: the run already finished; a memory write that
    // fails is reported, never propagated.
    logDebug(`[run-outcome-memory] write failed for ${key}: ${String(err)}`);
    return false;
  }
}

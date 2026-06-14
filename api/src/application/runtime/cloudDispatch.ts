/**
 * Where a V2 cloud agent executes — its "runtime surface". BOTH run the full task
 * in the cloud (everything is Cloudflare — no local/hybrid agent):
 *   • 'durable'   — a Durable Object (CloudRunnerDO), one LLM step per alarm tick.
 *     On-demand serverless; no always-on compute. The default.
 *   • 'container' — a long-lived Cloudflare Container runtime, for very long /
 *     continuous tasks that want a persistent process + shell. (Container infra is
 *     a future build; until then a 'container' run falls back to the durable DO so
 *     it still executes in the cloud.)
 *
 * Single source of truth for the routing decision so dispatch (runtime) and the
 * test agree on which surface a run targets.
 */
import { ExecutionStatus } from '../../domain/shared/types';

export type CloudSurface = 'durable' | 'container';

/**
 * Resolve the surface a run targets. An explicitly-pinned host is a long-lived
 * runtime (reached via the relay), so it maps to 'container'; otherwise honor the
 * agent's chosen surface, defaulting to 'durable' (on-demand, no always-on infra).
 */
export function resolveCloudSurface(agentSurface: string | undefined | null, hasExplicitHost: boolean): CloudSurface {
  if (hasExplicitHost) return 'container';
  return agentSurface === 'container' ? 'container' : 'durable';
}

export type CloudExecutor = 'container' | 'durable' | 'worker';

/**
 * Decide which cloud executor a run lands on, given the resolved capabilities.
 * Pure + exhaustively testable — this is the decision that was previously inlined
 * and BUGGY: a container was chosen on a bare binding without proving liveness, so
 * a dead container (the DO `/run` acks 202 even when the image can't boot) was
 * never downgraded and the run got orphan-reaped. Preference order:
 *   1. `container` — only when the run wants it, the binding exists, AND a health
 *      probe proved the container is actually live;
 *   2. `durable` (CloudRunnerDO) — the surviving serverless executor, whenever bound;
 *   3. `worker` — last-resort in-request loop (does NOT survive long runs); only
 *      when no durable runner is bound.
 */
export function chooseCloudExecutor(caps: {
  wantsContainer: boolean;
  hasContainerBinding: boolean;
  containerHealthy: boolean;
  hasCloudRunner: boolean;
}): CloudExecutor {
  if (caps.wantsContainer && caps.hasContainerBinding && caps.containerHealthy) return 'container';
  if (caps.hasCloudRunner) return 'durable';
  return 'worker';
}

/**
 * Probe a Cloudflare Container's `/health` before committing a run to it. The
 * container DO's `/run` handler acks `202` *immediately* and drives the agent loop
 * asynchronously, so a 202 does NOT prove the container actually booted and will
 * execute — an undeployed/unbootable image accepts the request and then silently
 * dies, leaving the run to be orphan-reaped (~30s) with no fallback. Probing
 * `/health` (bounded, never throws) gives a real liveness signal so the caller can
 * fall back to the durable executor instead. Returns false on any error/timeout/non-200.
 */
export async function probeContainerHealth(stub: { fetch: (input: string, init?: RequestInit) => Promise<Response> }): Promise<boolean> {
  try {
    const res = await stub.fetch('https://agent-container/health', { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Human-readable name for a cloud agent's type — the canonical taxonomy. Used in
 *  dispatch telemetry so the timeline says exactly which of the three cloud agent
 *  types (and surface) actually ran, not a bare engine string. */
export function cloudAgentTypeLabel(engine: string, surface: string): string {
  if (engine !== 'builderforce-v2') return 'V1 Cloud Agent';
  return surface === 'container' ? 'V2 Cloud Agent (Node/Container)' : 'V2 Cloud Agent (Durable Object)';
}

/** Terminal = the run has settled and has no live session to steer. A "Send" to a
 *  terminal run therefore starts a NEW run instead of being a silent no-op. */
export function isTerminalExecutionStatus(status: string | null | undefined): boolean {
  return status === ExecutionStatus.COMPLETED || status === ExecutionStatus.FAILED || status === ExecutionStatus.CANCELLED;
}

/** The cloud agent that ran a run, parsed off its execution payload. */
export function parseCloudAgentRef(payload: string | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { cloudAgentRef?: unknown };
    return typeof p.cloudAgentRef === 'string' && p.cloudAgentRef.trim() ? p.cloudAgentRef.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run-time repo selection off the payload. Returns:
 *   • a trimmed repo id  — pin this run to that repo,
 *   • ''                 — explicitly clear the pin (Auto-resolve),
 *   • undefined          — key absent, leave the existing pin untouched.
 * The tri-state lets "Auto" un-pin without clobbering a pin set by a prior run.
 */
export function parseRepoId(payload: string | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { repoId?: unknown };
    if (!('repoId' in p)) return undefined;
    return typeof p.repoId === 'string' ? p.repoId.trim() : '';
  } catch {
    return undefined;
  }
}

/** The pinned model off an execution payload (trimmed), or undefined when absent /
 *  blank / the payload is not JSON. The single reader of `payload.model` — the dispatch
 *  loop, the durable runner, and `withDefaultModel` all go through this. */
export function parseModel(payload: string | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { model?: unknown };
    return typeof p.model === 'string' && p.model.trim() ? p.model.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stamp a one-time "the orphan reaper re-queued this run on the durable executor"
 * flag into the execution payload. The reaper reads {@link wasReaperRequeued} on
 * the NEXT sweep: a run already carrying the flag is failed (not re-dispatched
 * again), so a stuck run gets at most one durable retry — never an infinite loop.
 */
export function markReaperRequeued(payload: string | null | undefined): string {
  let obj: Record<string, unknown> = {};
  if (payload) {
    try { obj = JSON.parse(payload) as Record<string, unknown>; } catch { obj = {}; }
  }
  obj.reaperRequeued = true;
  return JSON.stringify(obj);
}

/** True if a run has already been re-queued once by the reaper (see {@link markReaperRequeued}). */
export function wasReaperRequeued(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    return (JSON.parse(payload) as { reaperRequeued?: unknown }).reaperRequeued === true;
  } catch {
    return false;
  }
}

export interface FollowUpContext { directive: string; priorExecutionId: number | null }

/**
 * Parse a follow-up directive off a re-run's payload. A "Send" on a TERMINAL run
 * starts a NEW execution carrying `{ followUp: { directive, priorExecutionId } }`;
 * prepareCloudRun surfaces the directive as the headline instruction so the new
 * run treats the user's message as the goal (on top of the task + evolved PRD).
 */
export function parseFollowUp(payload: string | undefined): FollowUpContext | null {
  if (!payload) return null;
  try {
    const f = (JSON.parse(payload) as { followUp?: { directive?: unknown; priorExecutionId?: unknown } }).followUp;
    const directive = typeof f?.directive === 'string' ? f.directive.trim() : '';
    if (!directive) return null;
    const prior = typeof f?.priorExecutionId === 'number' && Number.isFinite(f.priorExecutionId) ? f.priorExecutionId : null;
    return { directive, priorExecutionId: prior };
  } catch {
    return null;
  }
}

/**
 * Build the payload for a follow-up run started from a terminal run's "Send": keep
 * the prior run's agent/model/repo pin so the re-run executes AS the same agent,
 * drop any stale one-shot blocks (a prior remediation/follow-up), and attach the
 * new directive. The directive becomes the headline instruction in prepareCloudRun.
 */
export function buildFollowUpPayload(priorPayload: string | null | undefined, followUp: { directive: string; priorExecutionId: number }): string {
  let obj: Record<string, unknown> = {};
  if (priorPayload) {
    try { obj = JSON.parse(priorPayload) as Record<string, unknown>; } catch { obj = {}; }
  }
  delete obj.remediation; // a re-run is not the prior run's auto-fix attempt
  obj.followUp = { directive: followUp.directive, priorExecutionId: followUp.priorExecutionId };
  return JSON.stringify(obj);
}

export interface RemediationContext { attempt: number; maxAttempts: number; buildError: string; runUrl: string | null }

/** Parse the post-merge build-failure remediation block off an auto-fix run's payload. */
export function parseRemediation(payload: string | undefined): RemediationContext | null {
  if (!payload) return null;
  try {
    const r = (JSON.parse(payload) as { remediation?: Record<string, unknown> }).remediation;
    if (!r || r.kind !== 'build_failure' || typeof r.buildError !== 'string') return null;
    return {
      attempt: typeof r.attempt === 'number' ? r.attempt : 1,
      maxAttempts: typeof r.maxAttempts === 'number' ? r.maxAttempts : 2,
      buildError: r.buildError,
      runUrl: typeof r.runUrl === 'string' ? r.runUrl : null,
    };
  } catch {
    return null;
  }
}

/**
 * Ensure the execution payload carries a model: an explicitly-pinned model wins,
 * otherwise fall back to the agent's own `base_model` so a V2 cloud run executes
 * AS the agent's model rather than the v1 gateway default. Returns the payload
 * unchanged when there is nothing to add (no fallback, or it can't be parsed).
 */
export function withDefaultModel(payload: string | undefined, baseModel: string | undefined): string | undefined {
  if (!baseModel) return payload;
  if (parseModel(payload)) return payload; // already pinned — leave as-is
  let obj: Record<string, unknown> = {};
  if (payload) {
    try { obj = JSON.parse(payload) as Record<string, unknown>; } catch { return payload; }
  }
  obj.model = baseModel;
  return JSON.stringify(obj);
}

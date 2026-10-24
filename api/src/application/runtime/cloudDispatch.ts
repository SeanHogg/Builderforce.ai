/**
 * Where a cloud run executes. There is ONE cloud runtime: every run, on every plan, runs
 * the one engine (`cloudAgentEngine.ts`) on the durable runner (CloudRunnerDO), and gets
 * a SANDBOX — a real shell and a working tree — from:
 *   • the Cloudflare Container (`sandbox/runSandbox.ts`), whenever one is bound and the
 *     ticket's repository can be cloned — the default; or
 *   • the repo's own GitHub Actions runner (`github_actions`), opted into per agent.
 * A run with neither still runs, editing over the git API without a shell, and its
 * timeline says why.
 *
 * The plan decides what a run is CHARGED (the monthly cloud-run allowance) — never where
 * it runs or what it can do. The `container` surface value (and the `containerRuntime`
 * plan feature that gated it) is legacy from when a container ran its own loop.
 *
 * Single source of truth for the routing decision so dispatch (runtime) and the
 * test agree on which surface a run targets.
 */
import { coercePolicyGates, type PolicyGate } from '@builderforce/agent-tools';
import { ExecutionStatus } from '../../domain/shared/types';
import { canonicalModelId } from '../llm/modelPool';
import { isArcStage, type ArcStage } from '@builderforce/workload';

/**
 * Where a cloud run's SANDBOX comes from. There is ONE cloud runtime: every run, on every
 * plan, runs the one engine on the durable runner (CloudRunnerDO). The surface says only
 * what serves its shell and working tree — the Cloudflare Container (`durable`, the
 * default) or the repo's own GitHub Actions runner (`github_actions`). The plan decides
 * what a run is charged (the monthly cloud-run allowance), never where it runs.
 */
export type CloudSurface = 'durable' | 'github_actions';

/**
 * Every surface value the platform accepts. `ide_agents.runtime_surface` is
 * varchar(16), so a value MUST stay within 16 characters — 'github_actions' is 14.
 * `container` is LEGACY: rows written while a container ran its own loop still hold it,
 * and it resolves to the one cloud runtime. Exported so the API's validation whitelist
 * and this union can never drift.
 */
export const CLOUD_SURFACES = ['durable', 'container', 'github_actions'] as const;

/**
 * Resolve the surface a run targets: the repo's Actions runners when the agent chose
 * them, else the one cloud runtime. An explicitly-pinned host is the customer's own
 * machine and is dispatched before this matters, so it reads as the cloud runtime here.
 * Unknown values (a row written by a client ahead of the server) degrade to the default
 * rather than failing a dispatch.
 */
export function resolveCloudSurface(agentSurface: string | undefined | null, hasExplicitHost: boolean): CloudSurface {
  return !hasExplicitHost && agentSurface === 'github_actions' ? 'github_actions' : 'durable';
}

/**
 * The executors a cloud run can land on — both are the durable runner driving the one
 * engine; `github_actions` additionally queues the repo's runner as its sandbox. Actions
 * is dispatched and then polled, which is why it carries its own (longer) silence
 * ceiling. There is no in-request Worker executor — a `waitUntil` background loop cannot
 * outlast the ~30s serverless wall, so {@link chooseCloudExecutor} fails fast to
 * `unavailable` rather than starting a run that provably cannot finish.
 */
export type CloudExecutor = 'durable' | 'github_actions';
export type CloudDispatchTarget = CloudExecutor | 'unavailable';

/**
 * Decide which cloud executor a run lands on. Pure + exhaustively testable:
 *   1. `github_actions` — the agent chose it, the repo carries the agent workflow, and a
 *      durable runner exists to drive the engine its runner serves;
 *   2. `durable` — whenever the durable runner is bound;
 *   3. `unavailable` — no durable runner. Dispatch fails fast.
 */
export function chooseCloudExecutor(caps: {
  hasCloudRunner: boolean;
  /** The agent asked to run on the repo's GitHub Actions runners. */
  wantsGithubActions?: boolean;
  /**
   * The agent workflow is present in the linked repo AND the credential can dispatch
   * it — a "can we queue work" signal: an Actions runner does not exist until GitHub
   * schedules one, so there is no liveness to probe.
   */
  githubActionsAvailable?: boolean;
}): CloudDispatchTarget {
  if (!caps.hasCloudRunner) return 'unavailable';
  return caps.wantsGithubActions && caps.githubActionsAvailable ? 'github_actions' : 'durable';
}

/**
 * Probe a Cloudflare Container's `/health` (bounded, never throws): the web-scan stages
 * and managed hosts check an instance is live before handing it work. Returns false on
 * any error/timeout/non-200.
 */
export async function probeContainerHealth(stub: { fetch: (input: string, init?: RequestInit) => Promise<Response> }): Promise<boolean> {
  try {
    const res = await stub.fetch('https://agent-container/health', { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Human-readable name for a cloud agent run by surface — the canonical taxonomy.
 *  Used in dispatch telemetry so the timeline says exactly which cloud surface ran.
 *  There is ONE engine, so only the surface varies — the label is just "Cloud Agent"
 *  plus the surface (no engine-version prefix). */
export function cloudAgentTypeLabel(surface: string): string {
  if (surface === 'github_actions') return 'Cloud Agent (GitHub Actions)';
  return 'Cloud Agent (Durable Object)';
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

/** Brain chat that originated a dispatched run. Absent for headless/board runs. */
export function parseOriginatingChatId(payload: string | null | undefined): number | undefined {
  if (!payload) return undefined;
  try {
    const value = (JSON.parse(payload) as { chatId?: unknown }).chatId;
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The ROLE a run ran AS, off its payload — the reviewer round-trip stamps `reviewRole`,
 *  a role-attributed producer stamps `actAsRole`. Drives manifest attribution at finalize
 *  and the approvals→sign-off bridge (a human approving a role's gate records that role's
 *  sign-off). Null when the run carries no role stamp. */
/**
 * True when a run was dispatched to fulfil a specific ROLE on a lane — a reviewer asked
 * for a verdict, or a producer asked for this stage's deliverable.
 *
 * Such a run must NOT move the ticket's lane when it completes. It runs against an
 * already-open ticket to answer a question; the answer (a recorded sign-off) is what
 * advances the stage, and the run merely finishing is not the answer. Without this,
 * `RuntimeService.update` fell through to the ordinary COMPLETED→next-lane path and the
 * reviewer's own completion pushed the ticket onward regardless of its verdict —
 * measured on task 387: a `manager:signoff-request` run completed in 20 seconds and the
 * lane moved 1.5 seconds later.
 *
 * Shares this module with {@link parseActAsRole} because it is the same payload contract:
 * `reviewRole` (a judgement) or `actAsRole` (a production) both mark a role-attributed run.
 */
export function isRoleAttributedRun(payload: string | null | undefined): boolean {
  return parseActAsRole(payload) !== undefined;
}

export function parseActAsRole(payload: string | null | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { actAsRole?: unknown; reviewRole?: unknown };
    const role = typeof p.actAsRole === 'string' ? p.actAsRole : typeof p.reviewRole === 'string' ? p.reviewRole : undefined;
    return role && role.trim() ? role.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Reviewer-only role stamp. Unlike parseActAsRole this intentionally excludes
 * producers: producer evidence is auto-attested from delivered work, while a
 * reviewer must submit an explicit approve/changes-requested judgement. */
export function parseReviewRole(payload: string | null | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { reviewRole?: unknown };
    return typeof p.reviewRole === 'string' && p.reviewRole.trim()
      ? p.reviewRole.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The LANE a role-attributed run serves, off its payload.
 *
 * A role run is dispatched against the accountability slot's OWN stage, which is not
 * always the ticket's current status: an outstanding pre-review slot is asked for while
 * the ticket already sits in `in_review`. Anything authorizing such a run has to measure
 * it against THIS lane, not against `tasks.status` — see `authorizeManagedTaskExecution`.
 */
export function parseLaneKey(payload: string | null | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { laneKey?: unknown };
    return typeof p.laneKey === 'string' && p.laneKey.trim() ? p.laneKey.trim() : undefined;
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

/**
 * The pinned model off an execution payload (trimmed and REWRITTEN through the
 * supersession map), or undefined when absent / blank / the payload is not JSON. The
 * single reader of `payload.model` — the dispatch loop, the durable runner, and
 * `withDefaultModel` all go through this.
 *
 * An execution payload is DURABLE STATE, and long-lived state is exactly what
 * `canonicalModelId` exists for: the payload is written once at dispatch (from a lane
 * agent's `model` column, a manifest role approver, a re-dispatch copying the prior
 * run's pin) and can be read back weeks later, after the vendor has retired that id.
 * The gateway seam (`LlmProxyService.complete`) rewrites `body.model`, but a stale id
 * read HERE still leads the BYO chain and still names the failing model in every
 * diagnostic — measured as **555 reviewer-run failures on `claude-opus-4-8`**, a
 * superseded id no agent row pins, reported as `byo_unavailable` with four providers
 * connected. Rewriting at the reader means no caller can reintroduce it.
 */
export function parseModel(payload: string | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const p = JSON.parse(payload) as { model?: unknown };
    if (typeof p.model !== 'string' || !p.model.trim()) return undefined;
    return canonicalModelId(p.model) || undefined;
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

/**
 * Parse a client-computed SSM recall bias off a run payload (Learned Model Routing,
 * PRD 13 §6.6). An INTERACTIVE launch may attach `{ routingBias: { <model>: weight } }`
 * — a small nudge map the browser computed on its GPU (embed the task → kNN over this
 * repo's prior winning models). Headless runs omit it. Coerced defensively: only
 * string→finite-number entries survive, capped to a sane magnitude so a malformed
 * client can't dominate the learned score. Returns undefined when absent/empty.
 */
export function parseRoutingBias(payload: string | undefined): Record<string, number> | undefined {
  if (!payload) return undefined;
  try {
    const raw = (JSON.parse(payload) as { routingBias?: unknown }).routingBias;
    if (!raw || typeof raw !== 'object') return undefined;
    const out: Record<string, number> = {};
    for (const [model, w] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof w === 'number' ? w : Number(w);
      if (model && Number.isFinite(n) && n !== 0) out[model] = Math.max(-1, Math.min(1, n));
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse the launching canvas session's ARC STAGE off a run payload — same shape
 * and same reason as {@link parseRoutingBias}: a per-session client fact
 * (`frontend/src/lib/canvasPhases.ts` — "no field anywhere stores it") riding the
 * dispatch payload as an ephemeral nudge rather than becoming a durable column. A
 * task-runner launch outside any canvas simply omits it. Returns undefined on
 * anything but one of the five known stages.
 */
export function parseArcStage(payload: string | undefined): ArcStage | undefined {
  if (!payload) return undefined;
  try {
    const raw = (JSON.parse(payload) as { arcStage?: unknown }).arcStage;
    return isArcStage(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse the compiled governance gates off a run's payload (compile-primitive policy
 * modality). A run started by `deploy()`-and-dispatch carries `{ policyGates: [...] }`;
 * the cloud loop enforces them at its tool seam via `evaluatePolicyGate`. Coerced
 * defensively (only well-formed `{id, effect}` gates survive) so a malformed payload
 * can't crash the loop. Returns `[]` when absent — the loop then gates nothing.
 */
export function parsePolicyGates(payload: string | undefined): PolicyGate[] {
  if (!payload) return [];
  try {
    return coercePolicyGates((JSON.parse(payload) as { policyGates?: unknown }).policyGates);
  } catch {
    return [];
  }
}

/**
 * The role-participation instruction off a sign-off / producer dispatch payload.
 *
 * ── THE MEASURED FAILURE ─────────────────────────────────────────────────────
 * `buildSignoffRequestPayload` / `buildProducerRequestPayload` write a
 * `reviewInstruction` — the text that names the `builtin_kanban_signoff` tool and
 * tells the role to record its verdict — and NOTHING read it back. The field was
 * serialized into `executions.payload` and dropped on the floor, so the agent was
 * dispatched to review work it was never asked to sign off on.
 *
 * Measured on tenant 1 the day this was found: `builtin_kanban_signoff` invoked
 * **zero times, ever**; 912 reviewer slots stuck in `in_progress`; **0 of 2,263
 * reviewer slots ever completed**; all 327 ledger rows `autoAttested: true`, i.e.
 * every one written by the producer fallback in `attestRoleRun`, none by an agent.
 * Reviewer slots are deliberately never auto-credited (that would rubber-stamp a
 * review), so with the ask never delivered the sign-off gate could not be
 * satisfied by any number of runs — the tickets were unsatisfiable by
 * construction, which is what 2,351 completed runs against 0 finished tickets in
 * one day actually means.
 *
 * `attestRoleRun`'s header already documents two prior rounds of this same defect
 * (an HTTP route with no tool behind it; the catalog id instead of the advertised
 * tool name). Both were fixed in the INSTRUCTION. This is the third: the
 * instruction became correct and still never arrived.
 */
export function parseRoleInstruction(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const raw = (JSON.parse(payload) as { reviewInstruction?: unknown }).reviewInstruction;
    const instruction = typeof raw === 'string' ? raw.trim() : '';
    return instruction || null;
  } catch {
    return null;
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

export interface RemediationContext { attempt: number; maxAttempts: number; buildError: string; runUrl: string | null; phase: 'pre_merge' | 'post_merge' }

/** Parse a build-failure remediation block off an auto-fix run's payload. `phase`
 *  distinguishes a PR-branch (pre-merge) failure from a deploy-branch (post-merge)
 *  one; absent/garbage → 'post_merge' for back-compat with older payloads. */
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
      phase: r.phase === 'pre_merge' ? 'pre_merge' : 'post_merge',
    };
  } catch {
    return null;
  }
}

/**
 * The cloud executor a run actually landed on, parsed off its execution payload
 * (stamped by dispatch once {@link chooseCloudExecutor} decides). It must round-trip
 * every value {@link withExecutor} can stamp.
 *
 * It recognised only two for a long time, and both of the things that read the third
 * were silently dead as a result:
 *   • `githubActionsReconcile` SQL-prefilters on `"executor":"github_actions"` and then
 *     filters the rows through this function, described there as "what actually decides".
 *     It threw every candidate away, so the Actions reconcile sweep returned zero rows
 *     on every pass and an Actions run that never started was never reconciled.
 *   • `cloudSilenceCeilingMs` has an explicit `'github_actions'` branch giving that
 *     surface a 20-minute ceiling instead of the long-lived 5 minutes, precisely because
 *     a queued GitHub runner can legitimately sit silent for minutes before it starts.
 *     Falling through to `undefined` gave those runs the 5-minute ceiling, so the reaper
 *     could orphan a healthy queued run.
 *
 * An unrecognized value — including `'worker'` on a payload stamped before the
 * in-request Worker executor was removed — still parses as undefined, which the ceiling
 * helper treats as long-lived, so a live run is never reaped prematurely. */
export function parseExecutor(payload: string | null | undefined): CloudExecutor | undefined {
  if (!payload) return undefined;
  try {
    const e = (JSON.parse(payload) as { executor?: unknown }).executor;
    // `container` is legacy (a container once ran its own loop); it ran — and resumes —
    // as the one cloud runtime.
    if (e === 'container') return 'durable';
    return e === 'durable' || e === 'github_actions' ? e : undefined;
  } catch {
    return undefined;
  }
}

/** Stamp the resolved cloud executor into the execution payload so the orphan
 *  detectors can measure it against the right silence ceiling. Idempotent (re-stamps
 *  overwrite). Returns the payload unchanged shape with `executor` set. */
export function withExecutor(payload: string | null | undefined, executor: CloudExecutor): string {
  let obj: Record<string, unknown> = {};
  if (payload) {
    try { obj = JSON.parse(payload) as Record<string, unknown>; } catch { obj = {}; }
  }
  obj.executor = executor;
  return JSON.stringify(obj);
}

/**
 * What served a cloud run's shell and working tree, stamped on its payload by the
 * durable runner once its prep tick decides (`sandbox/runSandboxHost.ts`): `container`,
 * `actions`, or `none` (no container bound, no clonable repo, or it could not open — the
 * run then edited over the git API and could not build or test). The executor alone no
 * longer says, because every cloud run is the same durable executor.
 */
export type RunSandboxStamp = 'container' | 'actions' | 'none';

export function withRunSandbox(payload: string | null | undefined, sandbox: RunSandboxStamp): string {
  let obj: Record<string, unknown> = {};
  if (payload) {
    try { obj = JSON.parse(payload) as Record<string, unknown>; } catch { obj = {}; }
  }
  obj.sandbox = sandbox;
  return JSON.stringify(obj);
}

/** The stamp off a payload, or undefined for a run that predates it. */
export function parseRunSandbox(payload: string | null | undefined): RunSandboxStamp | undefined {
  if (!payload) return undefined;
  try {
    const v = (JSON.parse(payload) as { sandbox?: unknown }).sandbox;
    return v === 'container' || v === 'actions' || v === 'none' ? v : undefined;
  } catch {
    return undefined;
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

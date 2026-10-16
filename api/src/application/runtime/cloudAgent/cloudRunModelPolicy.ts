/**
 * WHICH MODEL each turn of a cloud run asks for, and what happens when that model
 * fails — the cloud binding of THE model hand-off policy (`@builderforce/run-policy`).
 *
 * Split out of `cloudAgentEngine.ts`, which used to carry its own copy of these rules
 * inline: a strict pin dropped once on 429/413/503 (and on a project-Evermind 400
 * "decline"), a soft seed locked onto whatever the gateway resolved on the first turn,
 * and no stall failover at all — a cloud run whose model only narrated tool calls was
 * accepted as finished. The container surface had NONE of it: every `llm` op re-picked
 * a soft seed, so an image run hopped models turn to turn and never released a pin.
 * Both surfaces now drive the same reducer the browser Brain, the server addressed
 * reply, the canvas and the on-prem runtime drive, and persist its state between steps
 * (the durable loop in `CloudLoopState`, the container in `containerRunModelStore`).
 *
 * ── THE PHASE RULE ──────────────────────────────────────────────────────────
 * A cloud run is a ticket being IMPLEMENTED, so it starts — and stays — in `code`: the
 * run holds one model for its whole life (the lock below), which is exactly the case
 * where the policy's implicit plan→code re-ask never fires. A delegated child carries
 * its own role (`CloudChildSpec.role`): a `plan` or `verify` child starts in that phase,
 * and a child delegated one kind of non-phase work (`explore`, `utility`, `chat`) asks
 * for that role on every turn. That is the effective role the loop always used
 * (`spec.role ?? 'code'`); it now rides every request so the gateway's role ordering
 * applies when a released pin hands the turn back to the cascade.
 *
 * Telemetry (`model.cascade`, `model.failover`, the stall events) is recorded here too,
 * so both surfaces report a hand-off the same way.
 */
import {
  initialRunPolicy,
  nextTurn,
  reduceRunPolicy,
  resolveStallStep,
  type RunPhase,
  type RunPolicyOptions,
  type RunPolicyOutcome,
  type RunPolicyState,
  type StallStep,
  type TurnRequest,
} from '@builderforce/run-policy';
import type { ModelFallbackSurface } from '@builderforce/agent-stall';
import { isModelRole } from '@builderforce/agent-tools';
import type { Db } from '../../../infrastructure/database/connection';
import { recordCloudToolEvent } from '../cloudToolEvents';

/** The policy state a cloud run carries between steps. Plain JSON. */
export interface CloudRunModelState {
  policy: RunPolicyState;
  /** Stall re-prompts spent on the CURRENT model (`agent-stall`'s budget). A turn that
   *  calls a tool resets it; a failover resets it. */
  stallRecoveries: number;
  /** One-shot `tool_choice` the last stall recovery forced on the next request. */
  forceToolChoice?: 'required';
}

/** What one turn asks for — the policy's request plus the one-shot forced tool choice. */
export interface CloudTurnRequest extends TurnRequest {
  toolChoice?: 'required';
}

/** Who the timeline events are about. */
export interface CloudRunRef {
  tenantId: number;
  cloudAgentRef?: string;
  executionId: number;
}

/**
 * A project's own self-learning head (`evermind/<ref>`) DECLINES a turn it is not
 * competent for with a 400 rather than serving it badly; the policy releases the pin
 * on it, so the run walks the cascade instead of dying on a head that is still learning.
 */
const DECLINING_MODEL_PREFIXES: readonly string[] = ['evermind/'];

const RUN_PHASES: ReadonlySet<string> = new Set<RunPhase>(['plan', 'code', 'verify']);

/** The phase rule (see the file header): where a cloud run starts, and whether its
 *  delegated role pins every turn. */
export function cloudRunPolicyRole(delegatedRole: string | null | undefined): Pick<RunPolicyOptions, 'startPhase' | 'fixedRole'> {
  const role = typeof delegatedRole === 'string' ? delegatedRole.trim() : '';
  if (RUN_PHASES.has(role)) return { startPhase: role as RunPhase };
  if (isModelRole(role)) return { startPhase: 'code', fixedRole: role };
  return { startPhase: 'code' };
}

/** The role the run's turns ask for — what the usage row and the pick are stamped with. */
export function cloudRunRole(delegatedRole: string | null | undefined): TurnRequest['role'] {
  return nextTurn(initialRunPolicy(cloudRunPolicyRole(delegatedRole)), { hasTools: true }).role;
}

/**
 * A fresh run's state, seeded from the run-start pick. The pick's model is asked for
 * strictly when it is an explicit pin, softly when it is the plan's seed; either way the
 * run LOCKS onto whatever served its first turn (DO ticks and container ops must not hop
 * models mid-task), and the pin is the run's own — released on 429/413/503 or a decline
 * rather than failing the run on one model.
 */
export function initialCloudRunModelState(
  pick: { model: string; strict: boolean },
  delegatedRole: string | null | undefined,
): CloudRunModelState {
  return {
    policy: initialRunPolicy({
      pinnedModel: pick.model,
      strictPin: pick.strict,
      pinReleasable: true,
      lockAfterFirstSuccess: true,
      decliningModelPrefixes: DECLINING_MODEL_PREFIXES,
      ...cloudRunPolicyRole(delegatedRole),
    }),
    stallRecoveries: 0,
  };
}

/**
 * The state a durable tick resumes from. A tick persisted before this state existed
 * carried only the locked model id (`legacyPinnedModel`); it resumes on that model with
 * the run-start strictness, exactly as it did before.
 */
export function resumeCloudRunModelState(
  saved: CloudRunModelState | undefined,
  legacyPinnedModel: string | undefined,
  pick: { model: string; strict: boolean },
  delegatedRole: string | null | undefined,
): CloudRunModelState {
  if (saved?.policy) return saved;
  return initialCloudRunModelState({ ...pick, model: legacyPinnedModel || pick.model }, delegatedRole);
}

/** The request fields a turn adds to a gateway completion body. */
export function turnRequestFields(req: CloudTurnRequest): {
  role: TurnRequest['role'];
  tool_choice: 'auto' | 'required';
  model?: string;
  modelStrict?: true;
  excludeModels?: string[];
} {
  return {
    role: req.role,
    tool_choice: req.toolChoice ?? 'auto',
    ...(req.model ? { model: req.model, ...(req.strict ? { modelStrict: true as const } : {}) } : {}),
    ...(req.excludeModels.length > 0 ? { excludeModels: req.excludeModels } : {}),
  };
}

type RetryOutcome = Extract<RunPolicyOutcome, { kind: 'retry_turn' }>;

/**
 * Run ONE turn under the policy: ask for what it says, and when the gateway answers
 * with a failure the policy routes around (a released pin or lock, a declined turn, a
 * transient failure under auto-routing) re-ask the turn once on the gateway's cascade.
 * `onRetry` records the hand-off. Returns the final result — a failure the policy does
 * not route around comes back as it is, for the caller's metering to report.
 */
export async function completeUnderRunPolicy<R extends { response: { status: number }; resolvedModel?: string }>(
  state: CloudRunModelState,
  call: (req: CloudTurnRequest) => Promise<R>,
  onRetry: (outcome: RetryOutcome) => Promise<void>,
): Promise<{ state: CloudRunModelState; result: R }> {
  const toolChoice = state.forceToolChoice;
  let policy = state.policy;
  const request = (): CloudTurnRequest => ({ ...nextTurn(policy, { hasTools: true }), ...(toolChoice ? { toolChoice } : {}) });
  const first = request();
  let result = await call(first);
  if (result.response.status >= 400) {
    policy = reduceRunPolicy(policy, {
      type: 'transport_failed',
      kind: 'transport',
      status: result.response.status,
      ...(first.model ? { model: first.model } : {}),
    });
    if (policy.outcome.kind === 'retry_turn') {
      await onRetry(policy.outcome);
      result = await call(request());
    }
  }
  if (result.response.status < 400) {
    policy = reduceRunPolicy(policy, { type: 'turn_succeeded', ...(result.resolvedModel ? { model: result.resolvedModel } : {}) });
  }
  // The forced tool choice was one-shot: this request spent it.
  return { state: { policy, stallRecoveries: state.stallRecoveries }, result };
}

/** Timeline wording for a pin or lock the policy released. */
function cascadeReason(outcome: RetryOutcome): string {
  if (!outcome.released) return 'gateway request failed — retrying once on the cascade';
  if (outcome.status === 413) return 'pinned model context window too small — dropping pin, walking the cascade to a bigger-window model';
  if (outcome.status === 503) return 'pinned model unavailable (cooldown / provider outage) — dropping pin, walking the cascade';
  if (outcome.status === 400) return 'project Evermind declined this turn (low tool-choice confidence or incoherent output) — dropping pin, walking the cascade';
  return 'pinned model rate-limited — dropping pin, walking the cascade';
}

/** Record a policy retry on the run's timeline. Best-effort, like every timeline write. */
export async function recordModelCascade(db: Db, run: CloudRunRef, outcome: RetryOutcome, step?: number): Promise<void> {
  await recordCloudToolEvent(db, {
    ...run,
    toolName: 'model.cascade', category: 'llm',
    detail: { step, from: outcome.released ?? null, reason: outcome.status != null ? String(outcome.status) : 'transport' },
    result: cascadeReason(outcome),
  });
}

/**
 * The stall step for a cloud turn (`resolveStallStep`): a turn that called a tool
 * resets the re-prompt budget; one that only narrated is re-prompted, then failed over
 * onto a different model, then stopped with an explanation.
 */
export function cloudStallStep(
  state: CloudRunModelState,
  turn: { text: string; toolCallCount: number; toolNames: readonly string[]; requestText: string; resolvedModel?: string },
  surface: ModelFallbackSurface | null,
): { state: CloudRunModelState; step: StallStep } {
  if (turn.toolCallCount > 0) return { state: { ...state, stallRecoveries: 0 }, step: { kind: 'none' } };
  const { policy, step } = resolveStallStep(state.policy, {
    text: turn.text,
    toolCallCount: 0,
    availableToolNames: turn.toolNames,
    requestText: turn.requestText,
    ...(turn.resolvedModel && turn.resolvedModel !== 'default' ? { resolvedModel: turn.resolvedModel } : {}),
  }, state.stallRecoveries, { surface });
  if (step.kind === 'nudge' || step.kind === 'failover') {
    return {
      state: { policy, stallRecoveries: step.recoveriesUsed, ...(step.toolChoice ? { forceToolChoice: step.toolChoice } : {}) },
      step,
    };
  }
  return { state: { ...state, policy }, step };
}

/** Record a stall step on the run's timeline. */
export async function recordStallStep(db: Db, run: CloudRunRef, step: StallStep, model: string | undefined, stepIndex?: number): Promise<void> {
  if (step.kind === 'none') return;
  if (step.kind === 'nudge') {
    await recordCloudToolEvent(db, {
      ...run, toolName: 'loop.stall_recovery', category: 'llm',
      detail: { step: stepIndex, model: model ?? null, attempt: step.recoveriesUsed, shape: step.shape },
      result: `turn made no tool call (${step.shape ?? 'stall'}) — re-prompted to act (${step.recoveriesUsed})`,
    });
    return;
  }
  if (step.kind === 'failover') {
    await recordCloudToolEvent(db, {
      ...run, toolName: 'model.failover', category: 'llm',
      detail: { step: stepIndex, from: step.from ?? null, to: step.to, attempt: step.attempt, of: step.of, shape: step.shape },
      result: step.notice,
    });
    return;
  }
  await recordCloudToolEvent(db, {
    ...run, toolName: 'loop.stall_unrecovered', category: 'error',
    detail: { step: stepIndex, model: model ?? null, tried: step.tried, shape: step.shape },
    result: step.notice.slice(0, 600),
  });
}

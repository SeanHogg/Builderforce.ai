/**
 * policy/model — `policy/model/**` — the role ladder, the cascade, the learned routing,
 * the pins, the inference-mode rules, the BYO resolution signal and the preflight that
 * names a degraded model before turn 1.
 *
 * Owned by WS2g. Ports, without rewriting, the model half of every entry point:
 *   • `cloudAgent/cloudRunModelPolicy.ts` — the phase rule, the turn hand-off under the
 *     policy, the cascade reasons and the stall step;
 *   • the cascade, the learned routing and the limbic state — `@builderforce/run-policy`
 *     (the reducer `ctx.state.model` already IS; this module drives it, never redefines it);
 *   • the @-reply cascade — the same reducer, asked with `hasTools: false`;
 *   • `clients/vscode/src/modelRouting.ts` policy half — Local only / Hybrid / Specific:
 *     what each mode promises, when a turn may be served on this machine first, when a
 *     pinned provider that cannot authorize fails the turn vs. falls back;
 *   • `frontend/src/lib/canvasModelPort.ts` policy half — the canvas turn asks for what
 *     the policy says (role / model / strictness / exclusions) and reports success back;
 *   • the on-prem gateway model config — the pinned / specific / auto rules;
 *   • the BYO resolution signal (`tenantProviderKeyService.unresolvedReasons`,
 *     `byoCredentialHealth.ts`) — why a configured credential could not be used, and the
 *     preflight classification that turns it into a `model.preflight` notice.
 *
 * The slice of `RunState` is `RunState.model` (`@builderforce/run-policy`'s
 * `RunPolicyState`) plus one volatile per-run extras block (`ModelRunState.extras`),
 * which the composition carries beside the state JSON. Neither is redefined here.
 *
 * The hook decides; it never dispatches. `resolve` names the model (and the cap) the
 * turn asks for, or nothing to let the surface choose; `recordSuccess`,
 * `recordTransportFailure` and `stallStep` are what a loop calls around and after the
 * call — the port of `completeUnderRunPolicy` and `cloudStallStep`. `classifyPreflight`
 * is the port of the BYO preflight, answered from the unresolved reasons before turn 1.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node. Zero runtime deps beyond the workspace's own packages.
 */

import type { ModelFallbackSurface } from "@builderforce/agent-stall";
import {
  cappedMaxTokens,
  initialRunPolicy,
  nextTurn,
  reduceRunPolicy,
  resolveStallStep,
  type RunPhase,
  type RunPolicyEvent,
  type RunPolicyOptions,
  type RunPolicyState,
  type StallStep,
  type TurnRequest,
} from "@builderforce/run-policy";

import { isModelRole } from "@builderforce/agent-tools";
import type { ModelHook } from "../hooks.js";
import { recoverProviderFailure } from "./failure.js";

export type { RunPolicyEvent, RunPolicyState, StallStep, TurnRequest };

// ── The state slice (RunState.model is RunPolicyState; extras ride beside it) ──

/**
 * What the model policy carries across a step boundary, beyond `RunState.model`
 * (`@builderforce/run-policy`'s `RunPolicyState`).
 *
 * `stallRecoveries` and `forceToolChoice` are the host-owned extras `cloudRunModelPolicy`
 * persisted beside the policy: the re-prompt count spent on the CURRENT model, and the
 * one-shot `tool_choice` a stall recovery forces on the next request. `preflightNotices`
 * is the run-start list of `model.preflight` notices the BYO preflight named before
 * turn 1. All three are plain JSON; none of them redefines anything run-policy owns.
 */
export interface ModelRunState {
  /** The model hand-off policy — the reducer's state. */
  readonly policy: RunPolicyState;
  /** Re-prompts already spent on the current model; resets on a failover. */
  stallRecoveries: number;
  /** A one-shot `tool_choice: "required"` to spend on the next request. */
  forceToolChoice?: "required";
  /** The `model.preflight` notices named before turn 1. */
  readonly preflightNotices: readonly string[];
}

/** The result of a turn under the policy: the next state and the request to make. */
export interface PolicyTurnRequest extends TurnRequest {
  toolChoice?: "required";
}

// ── The phase rule (cloudRunModelPolicy.ts) ─────────────────────────────────

const RUN_PHASES: ReadonlySet<string> = new Set<RunPhase>(["plan", "code", "verify"]);

type ModelRole = TurnRequest["role"];

/**
 * The phase rule: where a run starts, and whether its delegated role pins every turn.
 * A run implementing a ticket codes; a `plan` or `verify` child starts in that phase;
 * a child delegated one kind of non-phase work (`explore`, `utility`, `chat`) asks for
 * that role on every turn; anything else (a board delivery role such as `reviewer`)
 * is not a model role, so the run still codes.
 */
export function policyRole(delegatedRole: string | null | undefined): Pick<RunPolicyOptions, "startPhase" | "fixedRole"> {
  const role = typeof delegatedRole === "string" ? delegatedRole.trim() : "";
  if (RUN_PHASES.has(role)) return { startPhase: role as RunPhase };
  if (isModelRole(role)) return { startPhase: "code", fixedRole: role as ModelRole };
  return { startPhase: "code" };
}

/** The role the run's turns ask for — what the pick and the usage row are stamped with. */
export function turnRole(delegatedRole: string | null | undefined): TurnRequest["role"] {
  return nextTurn(initialModelRunState({ pick: { model: delegatedRole ?? "", strict: false }, delegatedRole }).policy, { hasTools: true }).role;
}

// ── The run-start pick (cloudRunModelPolicy.ts) ─────────────────────────────

/**
 * A project's own self-learning head (`evermind/<ref>`) DECLINES a turn it is not
 * competent for with a 400 rather than serving it badly; the policy releases the pin
 * on it, so the run walks the cascade instead of dying on a head that is still learning.
 */
const DECLINING_MODEL_PREFIXES: readonly string[] = ["evermind/"];

/** The policy options a run start is seeded with — shared by the fresh and resumed paths. */
function startOptions(
  pick: { model: string; strict: boolean },
  delegatedRole: string | null | undefined,
  phaseModels?: RunPolicyOptions["phaseModels"],
): RunPolicyOptions {
  const verify = phaseModels?.verify;
  const reviewModel = typeof verify === "string" && verify.trim() ? verify.trim() : null;
  return {
    pinnedModel: pick.model,
    strictPin: pick.strict,
    pinReleasable: true,
    lockAfterFirstSuccess: true,
    decliningModelPrefixes: DECLINING_MODEL_PREFIXES,
    ...policyRole(delegatedRole),
    ...(phaseModels ? { phaseModels } : {}),
    reviewModel,
  };
}

/**
 * A fresh run's state, seeded from the run-start pick. The pick's model is asked for
 * strictly when it is an explicit pin, softly when it is the plan's seed; either way
 * the run LOCKS onto whatever served its first turn (a run must not hop models
 * mid-task), and the pin is the run's own — released on 429/413/503 or a decline
 * rather than failing the run on one model.
 */
export function initialModelRunState(input: {
  pick: { model: string; strict: boolean };
  delegatedRole: string | null | undefined;
  phaseModels?: RunPolicyOptions["phaseModels"];
  /** Stall re-prompts already spent on the current model (a resumed run). */
  stallRecoveries?: number;
  /** One-shot `tool_choice` a stall recovery forced on the next request. */
  forceToolChoice?: "required";
  /** The `model.preflight` notices named before turn 1 (BYO preflight). */
  preflightNotices?: readonly string[];
}): ModelRunState {
  return {
    policy: initialRunPolicy(startOptions(input.pick, input.delegatedRole, input.phaseModels)),
    stallRecoveries: input.stallRecoveries ?? 0,
    ...(input.forceToolChoice ? { forceToolChoice: input.forceToolChoice } : {}),
    preflightNotices: [...(input.preflightNotices ?? [])],
  };
}

/**
 * The state a durable tick resumes from. A tick persisted before the policy existed
 * carried only the locked model id (`legacyPinnedModel`); it resumes on that model with
 * the run-start strictness, exactly as it did before.
 */
export function resumeModelRunState(
  saved: ModelRunState | undefined,
  legacyPinnedModel: string | undefined,
  pick: { model: string; strict: boolean },
  delegatedRole: string | null | undefined,
  phaseModels?: RunPolicyOptions["phaseModels"],
): ModelRunState {
  if (saved?.policy) {
    if (!phaseModels) return saved;
    const verify = phaseModels.verify;
    const reviewModel = typeof verify === "string" && verify.trim() ? verify.trim() : (saved.policy.options.reviewModel ?? null);
    return {
      ...saved,
      policy: {
        ...saved.policy,
        options: { ...saved.policy.options, phaseModels, reviewModel },
      },
    };
  }
  return initialModelRunState({ pick: { ...pick, model: legacyPinnedModel || pick.model }, delegatedRole, phaseModels });
}

/** The request fields a turn adds to a completion body. */
export function turnRequestFields(req: TurnRequest & { toolChoice?: "required" }): {
  role: TurnRequest["role"];
  tool_choice: "auto" | "required";
  model?: string;
  modelStrict?: true;
  excludeModels?: string[];
} {
  return {
    role: req.role,
    tool_choice: req.toolChoice ?? "auto",
    ...(req.model ? { model: req.model, ...(req.strict ? { modelStrict: true as const } : {}) } : {}),
    ...(req.excludeModels.length > 0 ? { excludeModels: req.excludeModels } : {}),
  };
}

// ── The turn hand-off (completeUnderRunPolicy) ──────────────────────────────

type RetryOutcome = Extract<RunPolicyState["outcome"], { kind: "retry_turn" }>;

/**
 * What one turn asks for — the policy's request plus the one-shot forced tool choice.
 * Pure: derived from `state.policy` (and the pending one-shot) without mutating it.
 */
export function requestForTurn(state: ModelRunState, hasTools: boolean): TurnRequest & { toolChoice?: "required" } {
  return { ...nextTurn(state.policy, { hasTools }), ...(state.forceToolChoice ? { toolChoice: state.forceToolChoice } : {}) };
}

/**
 * Report a transport failure and, when the policy routes around it, the turn the
 * cascade now asks for. Returns the reduced state and the re-ask, or null when the
 * failure is one the policy does not route around (the turn fails as it is).
 */
export function routeAroundFailure(
  state: ModelRunState,
  request: TurnRequest,
  failure: { kind: "interrupted" | "transport" | "unreachable"; status?: number },
): { state: ModelRunState; retry: (TurnRequest & { toolChoice?: "required" }) | null } {
  const policy = reduceRunPolicy(state.policy, {
    type: "transport_failed",
    kind: failure.kind,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    ...(request.model ? { model: request.model } : {}),
  });
  const next = { ...state, policy };
  return policy.outcome.kind === "retry_turn"
    ? { state: next, retry: requestForTurn(next, true) }
    : { state: next, retry: null };
}

/** The outcome of a released pin or lock — the cascade's hand-off. */
export function retryOutcome(state: ModelRunState): RetryOutcome | null {
  return state.policy.outcome.kind === "retry_turn" ? state.policy.outcome : null;
}

/**
 * The turn succeeded: lock onto what served it (when configured to), record it proven
 * when it acted, and clear the one-shot forced tool choice — it was spent on this call.
 */
export function recordSuccess(state: ModelRunState, served: { model?: string; acted?: boolean }): ModelRunState {
  const policy = reduceRunPolicy(state.policy, {
    type: "turn_succeeded",
    ...(served.model ? { model: served.model } : {}),
    ...(served.acted ? { acted: true } : {}),
  });
  return { ...state, policy, forceToolChoice: undefined };
}

/** Timeline wording for a pin or lock the policy released (`cascadeReason`). */
export function cascadeReason(outcome: RetryOutcome): string {
  if (!outcome.released) return "gateway request failed — retrying once on the cascade";
  if (outcome.status === 413) return "pinned model context window too small — dropping pin, walking the cascade to a bigger-window model";
  if (outcome.status === 503) return "pinned model unavailable (cooldown / provider outage) — dropping pin, walking the cascade";
  if (outcome.status === 400) return "project Evermind declined this turn (low tool-choice confidence or incoherent output) — dropping pin, walking the cascade";
  return "pinned model rate-limited — dropping pin, walking the cascade";
}

// ── The stall step (cloudStallStep) ─────────────────────────────────────────

/**
 * The stall step for a turn (`resolveStallStep`): a turn that called a tool resets the
 * re-prompt budget; one that only narrated is re-prompted, then failed over onto a
 * different model, then stops with an explanation.
 */
export function stallStep(
  state: ModelRunState,
  turn: { text: string; toolCallCount: number; toolNames: readonly string[]; requestText: string; resolvedModel?: string },
  surface?: ModelFallbackSurface | null,
): { state: ModelRunState; step: StallStep } {
  if (turn.toolCallCount > 0) return { state: { ...state, stallRecoveries: 0 }, step: { kind: "none" } };
  const { policy, step } = resolveStallStep(state.policy, {
    text: turn.text,
    toolCallCount: 0,
    availableToolNames: turn.toolNames,
    requestText: turn.requestText,
    ...(turn.resolvedModel && turn.resolvedModel !== "default" ? { resolvedModel: turn.resolvedModel } : {}),
  }, state.stallRecoveries, { surface });
  if (step.kind === "nudge" || step.kind === "failover") {
    return {
      state: { ...state, policy, stallRecoveries: step.recoveriesUsed, ...(step.toolChoice ? { forceToolChoice: step.toolChoice } : {}) },
      step,
    };
  }
  return { state: { ...state, policy }, step };
}

// ── The inference-mode rules and the BYO preflight (preflight.ts) ───────────

export {
  classifyPreflight,
  inferenceDecision,
  localOnlyServable,
  modelDowngrade,
  modelPreflightEvent,
  planModelWarning,
  preflightVerdict,
  runModelPreflight,
  type ByoUnresolvedReason,
  type ModelDowngradeEvent,
  type ModelPreflightEvent,
  type PlanModelWarning,
  type UnresolvedReasons,
} from "./preflight.js";
import { modelDowngrade, runModelPreflight } from "./preflight.js";

// ── The hook (what runAgent drives) ─────────────────────────────────────────

/**
 * The model hook. `resolve` asks the policy what this turn wants: the pinned / locked /
 * phase-default model (or nothing, to auto-select) and the role cap on its answer. The
 * loop calls `recordSuccess` / `routeAroundFailure` / `stallStep` around the call — the
 * port of `completeUnderRunPolicy` and `cloudStallStep`; this object only decides.
 */
export const modelHook: ModelHook = {
  resolve(ctx) {
    // The model slice already IS the run-policy state; drive it, never redefine it.
    const ask = nextTurn(ctx.state.model, { hasTools: ctx.tools.length > 0 });
    const model = ask.model ?? undefined;
    const maxTokens = cappedMaxTokens(ask.role, undefined);
    // The whole request the policy makes of the gateway: the model and how strictly, the
    // role, the models routed around — `turnRequestFields`, handed to the transport as data.
    return {
      ...(model ? { model } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      role: ask.role,
      strict: ask.strict,
      excludeModels: ask.excludeModels,
    };
  },
  preflight: runModelPreflight,
  downgrade: modelDowngrade,
  recoverFailure: recoverProviderFailure,
};

export { recoverProviderFailure };

export default modelHook;

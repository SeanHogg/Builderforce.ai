/**
 * D1 — the weak-first verifier cascade, bound to the cloud loop (lever
 * `d1_verifier_cascade`). The decisions are `@builderforce/run-policy`'s `cascadeVerdict`;
 * this session holds the run's cascade state across durable ticks, turns a decision
 * into the run policy's `escalated` event, asks the difficulty router (D2) whether the
 * weak attempt is worth making at all, and records every verdict as a training row for it.
 *
 * Scope: only a SOFT seed cascades. An explicit pin (the user's, the agent's, a project
 * Evermind) is the run's declared model and is never moved off by the cascade.
 * Lever off ⇒ every method is inert and the run behaves exactly as before.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import { MODEL_TIERS, type ModelTier } from '@builderforce/model-catalog';
import type { DifficultyFeatures } from '@builderforce/difficulty-router';
import { isModelRole, type AgentExecParams, type AgentThinkLevel } from '@builderforce/agent-tools';
import {
  cascadeVerdict, initialCascadeState, nextTierModel, reduceRunPolicy, weakestTierModel,
  type CascadeState, type CascadeUnitKind, type CascadeVerdict, type TierLadder,
} from '@builderforce/run-policy';
import type { CloudRunModelState } from '../cloudAgent/cloudRunModelPolicy';
import { tierForModel } from '../../llm/vendors/registry';
import { codingFallbackSurface } from '../../llm/codingFallbackSurface';
import type { EffectivePlan } from '../../llm/LlmProxyService';
import { ROLE_REASONING_EFFORT, escalateThinkLevel } from '../../llm/roleReasoning';
import { recordCascadeOutcome, shouldSkipWeakAttempt, weakPassRate } from '../../llm/difficultyGate';
import { reportCaughtError } from '../../observability/caughtErrorReporter';

/** What the cascade persists across durable ticks. */
export interface CascadeSessionState {
  cascade?: CascadeState;
  /** The task's action type, resolved on the first tick (later ticks only have `other`). */
  actionType?: string;
  /** Whether this run's seed is soft (the cascade may move it). */
  soft?: boolean;
  /** The steer the next turn shows, until that turn ends. */
  steer?: string;
  /** D2's `priorWeakPassRate` for this tenant + action type, read once on the first
   *  tick (one cached aggregate, never a per-turn query) and carried thereafter. */
  priorWeakPassRate?: number;
  /** Whether that read happened (a cold tenant has no rate, and must not re-ask). */
  priorRead?: boolean;
}

/** A coding run's tier ladder: the tenant's connected flagships and the plan's coding
 *  pool — the same successors a stall failover may take (`codingFallbackSurface`). A
 *  tenant that connected providers runs on THEIR models only, so its ladder is theirs. */
export function cloudTierLadder(byoVendors: ReadonlySet<string>, plan: EffectivePlan, premiumOverride: boolean, byoStrict: boolean): TierLadder {
  const surface = codingFallbackSurface(byoVendors, plan, premiumOverride);
  const byo = (surface.byo?.models ?? []).map((m) => m.id).filter((id): id is string => !!id);
  const candidates = byoStrict && byo.length > 0 ? byo : surface.codingModels ?? [];
  return {
    candidates,
    rankOf: (model) => {
      const i = MODEL_TIERS.indexOf(tierForModel(model) as ModelTier);
      return i < 0 ? 1 : i;
    },
  };
}

export interface CascadeVerdictContext {
  db: unknown;
  tenantId: number;
  executionId: number;
  role: string;
  ladder: TierLadder;
  /** The model that produced the attempt (what the gateway resolved), when known. */
  attemptModel: string | undefined;
  features: DifficultyFeatures;
}

export class CascadeSession {
  readonly on: boolean;
  private cascade: CascadeState;
  private actionType: string | undefined;
  private soft: boolean;
  private steer: string | undefined;
  private steerShown = false;
  private priorWeakPassRate: number | undefined;
  private priorRead: boolean;

  constructor(
    private readonly env: unknown,
    private readonly tenantId: number,
    resume?: CascadeSessionState,
    /** The DB the prior-pass-rate aggregate reads through; absent ⇒ the feature is left unset. */
    private readonly db?: unknown,
  ) {
    this.on = isCostLeverOn(env, 'd1_verifier_cascade', tenantId);
    this.cascade = resume?.cascade ?? initialCascadeState();
    this.actionType = resume?.actionType;
    this.soft = resume?.soft ?? false;
    this.steer = resume?.steer;
    this.priorWeakPassRate = resume?.priorWeakPassRate;
    this.priorRead = resume?.priorRead ?? false;
  }

  /**
   * The step's features with the tenant's recent weak-pass rate for its action type —
   * the D2 head's prior. Read at most once per run (the reader is a cached aggregate);
   * a failed or empty read leaves the feature unset, which the head reads as 0.5.
   */
  private async withPrior(f: DifficultyFeatures): Promise<DifficultyFeatures> {
    if (typeof f.priorWeakPassRate === 'number') return f;
    if (!this.priorRead && this.db) {
      this.priorRead = true;
      try {
        this.priorWeakPassRate = await weakPassRate(this.env, this.db, this.tenantId, this.featuresActionType(f.actionType));
      } catch (error) {
        reportCaughtError(error, { source: 'application/runtime/costLoop/verifierCascade.ts', operation: 'weakPassRate', context: { tenantId: this.tenantId }, level: 'warning' });
      }
    }
    return typeof this.priorWeakPassRate === 'number' ? { ...f, priorWeakPassRate: this.priorWeakPassRate } : f;
  }

  /** The run's action type for D2 features (the first tick's resolution, kept). */
  featuresActionType(fallback: string): string {
    return this.actionType ?? fallback;
  }

  /**
   * The first tick's starting model. A soft seed starts on the WEAKEST tier of the
   * ladder — unless the difficulty router predicts the weak attempt would fail, in which
   * case it keeps the seed (the stronger default). A strict pin is left alone.
   */
  async seed(state: CloudRunModelState, a: { strict: boolean; ladder: TierLadder; features: DifficultyFeatures }): Promise<CloudRunModelState> {
    // Recorded whatever the lever says: the progress detector's escalation (A3) moves
    // only a soft run too, and later ticks need the first tick's action type.
    this.actionType = a.features.actionType;
    this.soft = !a.strict;
    if (!this.on || !this.soft) return state;
    if (await shouldSkipWeakAttempt(this.env, this.tenantId, await this.withPrior(a.features))) return state;
    const weak = weakestTierModel(a.ladder, state.policy.broken);
    if (!weak || weak === state.policy.model) return state;
    // A soft seed is a soft pin: asked for, not strict, so the first turn can still fail over.
    return { ...state, policy: { ...state.policy, model: weak, pin: weak, locked: false } };
  }

  /**
   * Fold a verifier verdict on a unit of work. Returns the run's new model state (the
   * same object when nothing moved). Every conclusive verdict on a soft run becomes a
   * D2 training row.
   */
  async verdict(state: CloudRunModelState, kind: CascadeUnitKind, verdict: CascadeVerdict, ctx: CascadeVerdictContext): Promise<CloudRunModelState> {
    if (!this.on || !this.soft || verdict.inconclusive) return state;
    const current = ctx.attemptModel && ctx.attemptModel !== 'default' ? ctx.attemptModel : state.policy.model;
    if (current) {
      const features = await this.withPrior(ctx.features);
      await recordCascadeOutcome(this.env, ctx.db, {
        tenantId: ctx.tenantId, executionId: String(ctx.executionId), actionType: this.featuresActionType(ctx.features.actionType),
        role: ctx.role, weakModel: current, passed: verdict.passed, verifier: verdict.verifier, features,
      });
    }
    const exclude = [...state.policy.broken, ...(state.policy.authorModel && state.policy.phase === 'verify' ? [state.policy.authorModel] : [])];
    const r = cascadeVerdict(this.cascade, kind, verdict, { current, ladder: ctx.ladder, exclude });
    this.cascade = r.state;
    switch (r.action.kind) {
      case 'escalate':
        this.setSteer(r.action.steer);
        return r.action.to ? { ...state, policy: reduceRunPolicy(state.policy, { type: 'escalated', to: r.action.to }) } : state;
      case 'exhausted':
        this.setSteer(r.action.steer);
        return state;
      case 'deescalate':
        return { ...state, policy: reduceRunPolicy(state.policy, { type: 'escalated', to: r.action.to }) };
      default:
        return state;
    }
  }

  /**
   * Move the run one tier up for a reason that is not a verifier's (the progress
   * detector's second trip). Null for a pinned run or when nothing is stronger — the
   * caller pauses instead. Gated by the CALLER's lever, not the cascade's.
   */
  escalate(state: CloudRunModelState, ladder: TierLadder, attemptModel: string | undefined): CloudRunModelState | null {
    if (!this.soft) return null;
    const current = attemptModel && attemptModel !== 'default' ? attemptModel : state.policy.model;
    const to = nextTierModel(ladder, current, state.policy.broken);
    if (!to) return null;
    this.cascade = { ...this.cascade, escalations: this.cascade.escalations + 1 };
    return { ...state, policy: reduceRunPolicy(state.policy, { type: 'escalated', to }) };
  }

  /**
   * The reasoning levers for a turn: the caller's (persona / role default), raised one
   * level per open escalation of the current unit. Inert with nothing escalated.
   */
  execParams(base: AgentExecParams | undefined, role: unknown): AgentExecParams | undefined {
    const boost = this.on ? this.cascade.reasoningBoost : 0;
    if (boost <= 0) return base;
    let level: AgentThinkLevel = base?.thinkLevel ?? (isModelRole(role) ? ROLE_REASONING_EFFORT[role] : 'medium');
    for (let i = 0; i < boost; i++) level = escalateThinkLevel(level);
    return { ...base, thinkLevel: level };
  }

  private setSteer(note: string): void {
    this.steer = note;
    this.steerShown = false;
  }

  /** The note the current turn's request carries ("" when none). */
  steerNote(): string {
    if (this.steer) this.steerShown = true;
    return this.steer ?? '';
  }

  /** A turn ended: a steer that has been shown once is done. */
  endTurn(): void {
    if (this.steerShown) {
      this.steer = undefined;
      this.steerShown = false;
    }
  }

  snapshot(): CascadeSessionState {
    return {
      ...(this.on ? { cascade: this.cascade } : {}),
      ...(this.actionType ? { actionType: this.actionType } : {}),
      soft: this.soft,
      ...(this.steer ? { steer: this.steer } : {}),
      ...(typeof this.priorWeakPassRate === 'number' ? { priorWeakPassRate: this.priorWeakPassRate } : {}),
      ...(this.priorRead ? { priorRead: true } : {}),
    };
  }
}

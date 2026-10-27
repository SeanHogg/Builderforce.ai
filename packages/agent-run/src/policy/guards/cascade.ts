/**
 * policy/guards/cascade.ts — D1: the weak-first verifier cascade, holding a run's
 * cascade state across steps and turning a verifier verdict into the run policy's
 * `escalated` event. Ported from `api/src/application/runtime/costLoop/verifierCascade.ts`
 * (`CascadeSession`).
 *
 * The DECISIONS are `@builderforce/run-policy`'s `cascadeVerdict` / `nextTierModel` /
 * `weakestTierModel` / `cascadeSteer`; this module holds the run's `CascadeSessionState`
 * and asks the host (through ports) for the two things the API engine coupled in:
 * the difficulty router's `shouldSkipWeakAttempt` (D2) and the weak-pass-rate prior.
 *
 * Scope: only a SOFT seed cascades. An explicit pin (the user's, the agent's, a project
 * Evermind) is the run's declared model and is never moved off by the cascade. Lever off
 * ⇒ every method is inert and the run behaves exactly as before.
 *
 * No `node:*` imports, no DOM.
 */

import {
  cascadeSteer,
  cascadeVerdict,
  initialCascadeState,
  nextTierModel,
  reduceRunPolicy,
  weakestTierModel,
  type CascadeState,
  type CascadeUnitKind,
  type CascadeVerdict,
  type RunPolicyState,
  type TierLadder,
} from "@builderforce/run-policy";
import type { CascadeSessionState } from "../../contract.js";

export type { CascadeSessionState };

/** What the cascade needs from the host — the API engine's couplings, as ports. */
export interface CascadePorts {
  /**
   * D2: would the weak attempt fail anyway? When supplied, a soft seed that would fail
   * keeps the stronger default. Absent ⇒ the weak attempt is always made.
   */
  shouldSkipWeakAttempt?: (features: { actionType: string; priorWeakPassRate?: number }) => Promise<boolean> | boolean;
  /** The tenant's recent weak-pass rate for this action type, read at most once per run. */
  weakPassRate?: (actionType: string) => Promise<number | undefined> | number | undefined;
  /** Record every conclusive verdict on a soft run as a D2 training row. */
  recordOutcome?: (row: {
    actionType: string;
    weakModel: string;
    passed: boolean;
    verifier: string;
    features: { actionType: string; priorWeakPassRate?: number };
  }) => Promise<void> | void;
  /**
   * Raise the reasoning effort one level per open escalation. The API engine used its
   * `escalateThinkLevel`; the host supplies the bump so this package needs no model role
   * table. Absent ⇒ the reasoning lever is left unraised.
   */
  escalateThinkLevel?: (level: string) => string;
  /** The role's default think level when the caller passed none (D4). */
  defaultThinkLevel?: string;
}

/** What `seed` needs to decide the first tick's starting model. */
export interface CascadeSeedArgs {
  strict: boolean;
  ladder: TierLadder;
  features: { actionType: string; priorWeakPassRate?: number };
}

export interface CascadeVerdictContext {
  ladder: TierLadder;
  /** The model that produced the attempt (what the gateway resolved), when known. */
  attemptModel: string | undefined;
  features: { actionType: string; priorWeakPassRate?: number };
}

export class CascadeSession {
  /** Whether the D1 lever is on. Lever off ⇒ every method is inert. */
  readonly on: boolean;
  private cascade: CascadeState;
  private actionType: string | undefined;
  private soft: boolean;
  private steer: string | undefined;
  private steerShown = false;
  private priorWeakPassRate: number | undefined;
  private priorRead: boolean;

  constructor(on: boolean, resume?: CascadeSessionState, private readonly ports: CascadePorts = {}) {
    this.on = on;
    this.cascade = resume?.cascade ?? initialCascadeState();
    this.actionType = resume?.actionType;
    this.soft = resume?.soft ?? false;
    this.steer = resume?.steer;
    this.priorWeakPassRate = resume?.priorWeakPassRate;
    this.priorRead = resume?.priorRead ?? false;
  }

  /**
   * The step's features with the tenant's recent weak-pass rate for its action type —
   * the D2 head's prior. Read at most once per run; a failed or empty read leaves the
   * feature unset, which the head reads as 0.5.
   */
  private async withPrior(f: { actionType: string; priorWeakPassRate?: number }): Promise<{ actionType: string; priorWeakPassRate?: number }> {
    if (typeof f.priorWeakPassRate === "number") return f;
    if (!this.priorRead && this.ports.weakPassRate) {
      this.priorRead = true;
      try {
        this.priorWeakPassRate = await this.ports.weakPassRate(this.featuresActionType(f.actionType));
      } catch {
        // A cold tenant has no rate; the feature stays unset.
      }
    }
    return typeof this.priorWeakPassRate === "number" ? { ...f, priorWeakPassRate: this.priorWeakPassRate } : f;
  }

  /** The run's action type for D2 features (the first tick's resolution, kept). */
  featuresActionType(fallback: string): string {
    return this.actionType ?? fallback;
  }

  /**
   * The first tick's starting model. A soft seed starts on the WEAKEST tier of the
   * ladder — unless the router predicts the weak attempt would fail, in which case it
   * keeps the seed (the stronger default). A strict pin is left alone.
   */
  async seed(state: RunPolicyState, a: CascadeSeedArgs): Promise<RunPolicyState> {
    // Recorded whatever the lever says: the progress detector's escalation (A3) moves
    // only a soft run too, and later ticks need the first tick's action type.
    this.actionType = a.features.actionType;
    this.soft = !a.strict;
    if (!this.on || !this.soft) return state;
    if (this.ports.shouldSkipWeakAttempt && await this.ports.shouldSkipWeakAttempt(await this.withPrior(a.features))) return state;
    const weak = weakestTierModel(a.ladder, state.broken);
    if (!weak || weak === state.model) return state;
    // A soft seed is a soft pin: asked for, not strict, so the first turn can still fail over.
    return { ...state, model: weak, pin: weak, locked: false };
  }

  /**
   * Fold a verifier verdict on a unit of work. Returns the run's new policy state (the
   * same object when nothing moved). Every conclusive verdict on a soft run becomes a D2
   * training row through the `recordOutcome` port.
   */
  async verdict(state: RunPolicyState, kind: CascadeUnitKind, verdict: CascadeVerdict, ctx: CascadeVerdictContext): Promise<RunPolicyState> {
    if (!this.on || !this.soft || verdict.inconclusive) return state;
    const current = ctx.attemptModel && ctx.attemptModel !== "default" ? ctx.attemptModel : state.model;
    if (current) {
      const features = await this.withPrior(ctx.features);
      await this.ports.recordOutcome?.({
        actionType: this.featuresActionType(ctx.features.actionType),
        weakModel: current,
        passed: verdict.passed,
        verifier: verdict.verifier,
        features,
      });
    }
    const exclude = [...state.broken, ...(state.authorModel && state.phase === "verify" ? [state.authorModel] : [])];
    const r = cascadeVerdict(this.cascade, kind, verdict, { current, ladder: ctx.ladder, exclude });
    this.cascade = r.state;
    switch (r.action.kind) {
      case "escalate":
        this.setSteer(r.action.steer);
        return r.action.to ? { ...state, ...reduceRunPolicy(state, { type: "escalated", to: r.action.to }) } : state;
      case "exhausted":
        this.setSteer(r.action.steer);
        return state;
      case "deescalate":
        return { ...state, ...reduceRunPolicy(state, { type: "escalated", to: r.action.to }) };
      default:
        return state;
    }
  }

  /**
   * Move the run one tier up for a reason that is not a verifier's (the progress
   * detector's second trip). Null for a pinned run or when nothing is stronger — the
   * caller pauses instead. Gated by the CALLER's lever, not the cascade's.
   */
  escalate(state: RunPolicyState, ladder: TierLadder, attemptModel: string | undefined): RunPolicyState | null {
    if (!this.soft) return null;
    const current = attemptModel && attemptModel !== "default" ? attemptModel : state.model;
    const to = nextTierModel(ladder, current, state.broken);
    if (!to) return null;
    this.cascade = { ...this.cascade, escalations: this.cascade.escalations + 1 };
    return { ...state, ...reduceRunPolicy(state, { type: "escalated", to }) };
  }

  /**
   * The reasoning levers for a turn: the caller's (persona / role default), raised one
   * level per open escalation of the current unit. Inert with nothing escalated or no
   * `escalateThinkLevel` port.
   */
  execParams(base: { thinkLevel?: string } | undefined): { thinkLevel?: string } | undefined {
    const boost = this.on ? this.cascade.reasoningBoost : 0;
    if (boost <= 0 || !this.ports.escalateThinkLevel) return base;
    let level: string = base?.thinkLevel ?? this.ports.defaultThinkLevel ?? "medium";
    for (let i = 0; i < boost; i += 1) level = this.ports.escalateThinkLevel(level);
    return { ...base, thinkLevel: level };
  }

  private setSteer(note: string): void {
    this.steer = note;
    this.steerShown = false;
  }

  /** The note the current turn's request carries ("" when none). */
  steerNote(): string {
    if (this.steer) this.steerShown = true;
    return this.steer ?? "";
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
      ...(typeof this.priorWeakPassRate === "number" ? { priorWeakPassRate: this.priorWeakPassRate } : {}),
      ...(this.priorRead ? { priorRead: true } : {}),
    };
  }
}

export { cascadeSteer };

/**
 * policy/guards — what a surface hands the guards: which levers are on (from
 * `RunPolicy.levers`) and the engine couplings as optional ports. Absent ⇒ that part is
 * inert. No `node:*` imports, no DOM.
 */

import type { DifficultyFeatures } from "@builderforce/difficulty-router";
import type { TierLadder } from "@builderforce/run-policy";
import type { RunState } from "../../contract.js";
import type { ProgressBinding } from "./forced/types.js";

export type { ProgressBinding };

/** Which levers this run has on. The host resolves them through `@builderforce/cost-levers`. */
export interface GuardLevers {
  a3_progress_detector?: boolean;
  d7_deterministic_handlers?: boolean;
  d1_verifier_cascade?: boolean;
  d8_parallel_tool_calls?: boolean;
}

/** The engine couplings the guards wrap, as optional ports a surface supplies. */
export interface GuardPorts {
  /** The run is bound to a repository. Absent ⇒ bound. An unbound run has no post-edit check (D7). */
  bound?: boolean;
  /** Read a written file's committed content (D7 edit check on the committed result). */
  read?: (path: string) => Promise<string | null>;
  /** The run's sandbox fast checks over the turn's edits (the D1 code unit's stronger verifier). */
  checks?: () => Promise<{ passed: boolean; verifier: string; reason?: string; steer?: string } | null>;
  /**
   * D1: the difficulty router's two couplings — would the weak attempt fail, and the
   * tenant's weak-pass-rate prior. Absent ⇒ the weak attempt is always made.
   */
  cascade?: {
    shouldSkipWeakAttempt?: (features: DifficultyFeatures) => Promise<boolean> | boolean;
    weakPassRate?: (actionType: string) => Promise<number | undefined> | number | undefined;
    /** Raise a think level one step (the surface's reasoning ladder). With none, D1's reasoning escalation is inert. */
    escalateThinkLevel?: (level: string) => string;
    /** The think level a run reasons at when the caller passed none (the role's default). */
    defaultThinkLevel?: string;
    recordOutcome?: (row: {
      actionType: string;
      weakModel: string;
      passed: boolean;
      verifier: string;
      features: DifficultyFeatures;
    }) => Promise<void> | void;
    /** The run's role's tier ladder (D1's cascade moves along it). */
    ladder?: TierLadder;
  };
  /**
   * The model's state, read and replaced by A3's escalation / D1's cascade. Absent ⇒ the hook binds the run's own
   * `state.model` (when a tier ladder is bound), so a surface almost never supplies it.
   */
  model?: {
    get(): RunState["model"];
    set(next: RunState["model"]): void;
  };
  /** What answered the latest turn (the gateway's resolution, for the cascade's record). */
  resolvedModel?: () => string | undefined;
  /** The run's role's tier ladder (A3's escalation and D1's cascade move along it). */
  ladder?: () => TierLadder;
  /** D2 features of the step about to be judged (the cascade keeps the action type). The hook hands the run's `state` (its transcript). */
  features?: (step: number, state?: RunState) => DifficultyFeatures;
  /** Record an escalation / progress-check event for the run's timeline; `at.step` is the kernel step the event belongs to (told only to a surface that binds {@link GuardPorts.progress}`.turns`). */
  onEvent?: (event: {
    tool: string;
    detail: Record<string, unknown>;
    result: string;
  }, at?: { step: number }) => Promise<void> | void;
  /**
   * A3's detector bound to the surface's own facts (which calls only read, which mutate, what counts as platform progress) and the
   * forced-turn ladder's vocabulary. With `turns` set, a trip's escalation or finish becomes a FORCED TURN the guards decide
   * (`GuardsHook.forcedTurn`), instead of a tier escalation / a tools-free final turn. Absent ⇒ the generic handling.
   */
  progress?: ProgressBinding;
}

/** The guard levers this run's policy switched on (`RunPolicy.levers`, `@builderforce/cost-levers` ids). */
export function guardLeversOf(levers: readonly string[]): GuardLevers {
  const on = new Set(levers);
  return {
    a3_progress_detector: on.has("a3_progress_detector"),
    d7_deterministic_handlers: on.has("d7_deterministic_handlers"),
    d1_verifier_cascade: on.has("d1_verifier_cascade"),
    d8_parallel_tool_calls: on.has("d8_parallel_tool_calls"),
  };
}

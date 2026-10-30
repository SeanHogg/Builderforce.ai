/**
 * policy/guards — the A3 progress detector, the D1 verifier cascade, the D7 post-edit
 * check and the D8 parallel-reads port, wired onto the kernel's hooks in one place.
 *
 * Owned by WS2d. Ports the cloud's retired per-tick `LoopGuards` behind the
 * `GuardsHook` contract `policy/hooks.ts` names. Each lever the source switched on
 * (`a3_progress_detector`, `d7_deterministic_handlers`, `d1_verifier_cascade`,
 * `d8_parallel_tool_calls`) is a constructor input here, read from `RunPolicy.levers` —
 * the host resolves which are on through `@builderforce/cost-levers`, never by branching
 * on `RunPolicy.entryPoint`. Lever off ⇒ that part is inert.
 *
 * The engine's model-hand-off, difficulty-router, DB-telemetry and sandbox couplings
 * arrive as optional PORTS a surface binds with {@link createGuardsHook}; absent, that
 * part is inert. The guard STATE a run carries across a step boundary is the contract's
 * `LoopGuardState`, mirrored field-for-field from the source.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and
 * Node.
 */

import { ProgressDetector, progressPauseQuestion, type ProgressAction } from "@builderforce/run-guards";
import type { DifficultyFeatures } from "@builderforce/difficulty-router";
import type { TierLadder } from "@builderforce/run-policy";
import type { LoopGuardState, RunState } from "../../contract.js";
import type { GuardControl, GuardsHook, PolicyContext, PolicyToolCall } from "../hooks.js";
import { CascadeSession } from "./cascade.js";
import { verifyAfterEdit, withPostEditNote } from "./postEdit.js";
import type { VerifyResult } from "./sourcePolicy.js";
import { isReadOnlyCloudTool } from "./readOnly.js";

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
  /** Park the run on a human question (A3's pause / the progress detector's last trip). */
  pause?: (question: string) => Promise<{ approvalId: string }> | { approvalId: string };
  /** The model's state, read and replaced by A3's escalation / D1's cascade. */
  model?: {
    get(): RunState["model"];
    set(next: RunState["model"]): void;
  };
  /** What answered the latest turn (the gateway's resolution, for the cascade's record). */
  resolvedModel?: () => string | undefined;
  /** The run's role's tier ladder (A3's escalation and D1's cascade move along it). */
  ladder?: () => TierLadder;
  /** D2 features of the step about to be judged (the cascade keeps the action type). */
  features?: (step: number) => DifficultyFeatures;
  /** Record an escalation / progress-check event for the run's timeline. */
  onEvent?: (event: {
    tool: string;
    detail: Record<string, unknown>;
    result: string;
  }) => Promise<void> | void;
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

/** A guards session for one run: the levers' state plus the turn's D7 edit verdicts. */
export class RunGuards {
  readonly cascade: CascadeSession;
  private readonly progress: ProgressDetector | null;
  private readonly postEdit: boolean;
  private readonly levers: GuardLevers;
  private pendingPause: string | undefined;
  /** This turn's post-edit verdicts — the D1 code unit's verifier. */
  private turnEdits: VerifyResult[] = [];
  /** D7: the sandbox checks' failures from the last turn, for the next turn's tail. */
  private checksNote = "";
  /** Moves UP the tier ladder this run (D1's failed verdicts, A3's second trip) — §8.2. */
  private escalations: number;

  constructor(levers: GuardLevers, resume?: LoopGuardState, ports: GuardPorts = {}) {
    this.levers = levers;
    this.cascade = new CascadeSession(!!levers.d1_verifier_cascade, resume?.cascade, {
      shouldSkipWeakAttempt: ports.cascade?.shouldSkipWeakAttempt
        ? (f) => ports.cascade!.shouldSkipWeakAttempt!({ actionType: f.actionType, priorWeakPassRate: f.priorWeakPassRate } as DifficultyFeatures)
        : undefined,
      weakPassRate: ports.cascade?.weakPassRate,
      escalateThinkLevel: ports.cascade?.escalateThinkLevel,
      defaultThinkLevel: ports.cascade?.defaultThinkLevel,
      recordOutcome: ports.cascade?.recordOutcome
        ? (row) => ports.cascade!.recordOutcome!({ ...row, features: row.features as DifficultyFeatures })
        : undefined,
    });
    this.progress = levers.a3_progress_detector
      ? new ProgressDetector(resume?.progress, { isReadOnly: (tool) => isReadOnlyCloudTool(tool) })
      : null;
    this.postEdit = !!levers.d7_deterministic_handlers;
    this.pendingPause = resume?.pendingPause;
    this.checksNote = resume?.checksNote ?? "";
    this.escalations = resume?.escalations ?? 0;
  }

  /** The volatile-tail sections this turn carries (empty strings drop out). */
  tailSections(): string[] {
    return [this.progress?.steerNote() ?? "", this.cascade.steerNote(), this.checksNote];
  }

  /** D1: the reasoning levers for a turn, raised while a unit is escalated. */
  reasoning(base: { thinkLevel?: string } | undefined): { thinkLevel?: string } | undefined {
    return this.cascade.execParams(base);
  }

  /** D1 + D2: the first tick's starting model (weak-first unless the router says skip). */
  seedModel(state: RunState["model"], a: { strict: boolean; ladder: TierLadder; features: DifficultyFeatures }): Promise<RunState["model"]> {
    return this.cascade.seed(state, a);
  }

  /** What the guards persist across a step boundary (the contract's `LoopGuardState`). */
  snapshot(): LoopGuardState {
    return {
      ...(this.progress ? { progress: this.progress.snapshot() } : {}),
      // The cascade's seed facts serve A3's escalation too; with both levers off nothing persists.
      ...(this.cascade.on || this.progress ? { cascade: this.cascade.snapshot() } : {}),
      ...(this.pendingPause ? { pendingPause: this.pendingPause } : {}),
      ...(this.checksNote ? { checksNote: this.checksNote } : {}),
      ...(this.escalations ? { escalations: this.escalations } : {}),
    };
  }

  /** Whether a call only reads (D8): the kernel's `isReadOnly` port. */
  isReadOnly(name: string): boolean {
    return this.levers.d8_parallel_tool_calls ? isReadOnlyCloudTool(name) : false;
  }

  /**
   * D7: check an edit the moment it lands; only a failure reaches the model, as one
   * note on that tool result. The verdict also feeds the D1 code unit's verifier.
   */
  async checkEdit(call: PolicyToolCall, data: unknown, ports: GuardPorts): Promise<unknown> {
    if (!this.postEdit && !this.cascade.on) return data;
    const verdict = await verifyAfterEdit(call, data, { read: ports.read, bound: ports.bound });
    if (!verdict) return data;
    this.turnEdits.push(verdict);
    return this.postEdit ? withPostEditNote(data, verdict) : data;
  }

  /**
   * D1: fold a finish attempt's gate verdict into the cascade; returns the block the
   * kernel reads. The finish hook calls this after its own gates.
   */
  async finish(verdict: { block: string | null; reason?: string }, step: number, ports: GuardPorts): Promise<string | null> {
    if (!this.cascade.on) return verdict.block;
    const v = verdict.block
      ? { passed: false, verifier: `finish_gates:${verdict.reason ?? "blocked"}`, reason: verdict.block, inconclusive: verdict.reason === "branch_ci_pending" || verdict.reason === "children_running" }
      : { passed: true, verifier: "finish_gates" };
    await this.judge("finish", v, step, ports);
    return verdict.block;
  }

  /** The turn ended: fold the turn's edits into the cascade and trip A3 if stuck. */
  async endTurn(step: number, ports: GuardPorts): Promise<void> {
    this.checksNote = "";
    if (this.turnEdits.length > 0) {
      const errors = this.turnEdits.flatMap((v) => v.errors);
      this.turnEdits = [];
      const staticVerdict = errors.length
        ? { passed: false, verifier: "changed_files", reason: errors.slice(0, 5).map((e) => `${e.path}${e.line ? `:${e.line}` : ""} ${e.message}`).join("; ") }
        : { passed: true, verifier: "changed_files" };
      // With a sandbox the project's own checks also judge the turn: a stronger
      // verifier than the static read of each file.
      const checks = ports.checks ? await ports.checks().catch(() => null) : null;
      if (checks?.steer && this.postEdit) this.checksNote = checks.steer;
      const verdict = checks && !checks.passed && staticVerdict.passed
        ? { passed: false, verifier: checks.verifier, ...(checks.reason ? { reason: checks.reason } : {}) }
        : staticVerdict;
      await this.judge("code_edit", verdict, step, ports);
    }
    this.cascade.endTurn();
    const action = this.progress?.endTurn();
    if (action) await this.onTrip(action, ports);
  }

  private async judge(kind: "finish" | "code_edit", verdict: { passed: boolean; verifier: string; reason?: string; inconclusive?: boolean }, step: number, ports: GuardPorts): Promise<void> {
    const model = ports.model;
    if (!model) return;
    const before = model.get();
    const features = ports.features?.(step) ?? { actionType: "other" };
    const after = await this.cascade.verdict(before, kind, verdict, {
      ladder: ports.ladder?.() ?? ports.cascade?.ladder ?? { candidates: [], rankOf: () => 1 },
      attemptModel: ports.resolvedModel?.(),
      features: { actionType: this.cascade.featuresActionType(features.actionType ?? "other") },
    });
    if (after === before) return;
    model.set(after);
    if (!verdict.passed) this.escalations += 1;
    await ports.onEvent?.({
      tool: "model.escalated",
      detail: { step, unit: kind, verifier: verdict.verifier, passed: verdict.passed, from: before.model ?? ports.resolvedModel?.() ?? null, to: after.model ?? null },
      result: verdict.passed
        ? `${kind} passed — back to ${after.model}`
        : `${kind} failed ${verdict.verifier} — escalated to ${after.model}`,
    });
  }

  private async onTrip(action: ProgressAction, ports: GuardPorts): Promise<void> {
    let outcome: string = action.kind;
    if (action.kind === "escalate") {
      const model = ports.model;
      const ladder = ports.ladder?.() ?? ports.cascade?.ladder;
      const next = model && ladder ? this.cascade.escalate(model.get(), ladder, ports.resolvedModel?.()) : null;
      if (next && model) {
        model.set(next);
        this.escalations += 1;
      } else {
        // Nothing stronger to move to (or the run is pinned): the second trip pauses.
        this.pendingPause = progressPauseQuestion(action.signal, action.trip);
        this.progress?.setSteer(undefined);
        outcome = "pause";
      }
    } else if (action.kind === "pause") {
      this.pendingPause = action.question;
    }
    await ports.onEvent?.({
      tool: "loop.progress_check",
      detail: { trip: action.trip, signal: action.signal, outcome, model: ports.model?.get().model ?? null },
      result: `progress check ${action.trip}: ${action.signal.kind} → ${outcome}`,
    });
  }

  /** A3: a pause parked the run — the next dispatched call returns it, once. */
  consumePendingPause(): string | undefined {
    const q = this.pendingPause;
    this.pendingPause = undefined;
    return q;
  }

  /**
   * A pause A3 parked the run on: the skip the model reads, with the `ask_human` control
   * so the kernel parks on the human answer (the same park the governance gate uses).
   * The engine's park port names the approval when the surface has one; without it the
   * run's HumanChannel is asked through the ask hook, with the two answers A3 offers.
   * `undefined` when the run is not parked — the kernel dispatches the call normally.
   */
  async beforeDispatchPause(ports: GuardPorts): Promise<{ data: unknown; control: GuardControl } | undefined> {
    const pending = this.consumePendingPause();
    if (pending === undefined) return undefined;
    const parked = ports.pause ? await ports.pause(pending) : undefined;
    return {
      data: { ok: false, error: `Paused for a human: ${pending}` },
      control: { kind: "ask_human", ...(parked ? { approvalId: parked.approvalId } : {}), question: pending, options: PAUSE_OPTIONS },
    };
  }

  /** A3: what the turn said, judged against what its calls did (WS8p). */
  noteTurnText(text: string): void {
    this.progress?.noteTurnText(text);
  }

  /** A3: every dispatched call is observed by the progress detector (when on). */
  observe(call: PolicyToolCall, result: unknown): void {
    if (!result || typeof result !== "object" || (result as { control?: unknown }).control) return;
    // The detector reads the outcome shape ({ data, isError? }), not the raw tool
    // result — wrap the dispatched result as the observed data.
    this.progress?.observe(call.name, call.args, { data: result });
  }
}

// ── The composition's hook ───────────────────────────────────────────────────

/** A3's pause offers the person these two answers (PRD 35 WS8p). */
const PAUSE_OPTIONS: readonly string[] = ["Continue with guidance", "Stop the run"];

/** Per-run guard sessions, keyed by the run the `PolicyContext` names. */
const sessions = new WeakMap<object, RunGuards>();

function sessionOf(ctx: PolicyContext, ports: GuardPorts): RunGuards {
  let s = sessions.get(ctx.state);
  if (!s) {
    s = new RunGuards(guardLeversOf(ctx.policy.levers), ctx.state.guards, ports);
    sessions.set(ctx.state, s);
    ctx.state.guards = s.snapshot();
  }
  return s;
}

/**
 * The A3 / D1 / D7 notes the next turn opens with (the volatile tail, never the cached
 * prefix): the progress detector's steer, the cascade's note and the sandbox checks'
 * failures. Empty when the guards have nothing to say. The memory policy composes it
 * into the turn's brief (the volatile tail).
 */
export function guardsTurnNote(ctx: PolicyContext): string {
  // A resumed tick asks for the brief before any guard hook ran on its state: read the
  // notes from the saved `state.guards` (as `sessionOf` rebuilds them), without caching
  // that portless session — the hooks build the run's own, with the surface's ports.
  const s = sessions.get(ctx.state) ?? new RunGuards(guardLeversOf(ctx.policy.levers), ctx.state.guards);
  return s.tailSections().filter((part) => part.trim().length > 0).join("\n\n");
}

/**
 * The guards hook for a surface's engine couplings. `beforeDispatch` skips the call when
 * A3 has parked the run on a human question (the skip the model reads, with the
 * ask_human control so the kernel parks on the answer); `observe` runs the D7 post-edit
 * check on the result and feeds the D1 cascade + A3 progress detector; `endTurn` folds
 * the turn — the turn's text first, so an unkept readiness claim counts (WS8p);
 * `isReadOnly` is D8's port, which the composition hands the kernel.
 *
 * The levers come from `RunPolicy.levers`, never from the entry point. The ports are the
 * surface's: an adapter binds them with `composePolicyHooks({ guards: createGuardsHook(ports) })`.
 * `RunGuards` also exposes `isReadOnly` (the D8 port) for the composition.
 */
export function createGuardsHook(ports: GuardPorts = {}): GuardsHook {
  return {
    async beforeDispatch(ctx: PolicyContext, _call: PolicyToolCall) {
      const g = sessionOf(ctx, ports);
      const paused = await g.beforeDispatchPause(ports);
      if (!paused) return undefined;
      ctx.state.guards = g.snapshot();
      return { skip: { data: paused.data, isError: true, control: paused.control } };
    },
    async observe(ctx: PolicyContext, call: PolicyToolCall, result: unknown) {
      const g = sessionOf(ctx, ports);
      const noted = await g.checkEdit(call, result, ports);
      g.observe(call, result);
      ctx.state.guards = g.snapshot();
      // D7: a failed post-edit check reaches the model on that call's own result.
      return noted !== result ? { data: noted } : undefined;
    },
    async endTurn(ctx: PolicyContext, content: string) {
      const g = sessionOf(ctx, ports);
      g.noteTurnText(content);
      await g.endTurn(ctx.step, ports);
      ctx.state.guards = g.snapshot();
    },
    isReadOnly(ctx: PolicyContext, name: string) {
      return sessionOf(ctx, ports).isReadOnly(name);
    },
    async seed(ctx: PolicyContext) {
      const ladder = ports.ladder?.() ?? ports.cascade?.ladder;
      if (!ladder) return undefined;
      const seeded = await sessionOf(ctx, ports).seedModel(ctx.state.model, {
        strict: ctx.policy.modelStart?.strict === true,
        ladder,
        features: ports.features?.(0) ?? { actionType: "other", role: ctx.policy.role, promptTokens: 0, toolCount: ctx.tools.length, turnIndex: 0 },
      });
      ctx.state.guards = sessionOf(ctx, ports).snapshot();
      return seeded;
    },
    reasoning(ctx: PolicyContext) {
      return sessionOf(ctx, ports).reasoning(undefined);
    },
    async finish(ctx: PolicyContext, verdict: { block: string | null; reason?: string }) {
      const g = sessionOf(ctx, ports);
      const block = await g.finish(verdict, ctx.step, ports);
      ctx.state.guards = g.snapshot();
      return block;
    },
  };
}

/** The guards hook with no engine couplings: A3's steer and its readiness claims still work. */
export const guardsHook: GuardsHook = createGuardsHook();

export { RunGuards as GuardsSession };

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

import type { ToolSchema } from "@builderforce/agent-tools";
import { ProgressDetector, progressSteerNote, progressTraceStep, type ProgressAction } from "@builderforce/run-guards";
import type { DifficultyFeatures } from "@builderforce/difficulty-router";
import type { TierLadder } from "@builderforce/run-policy";
import type { LoopGuardState, RunState } from "../../contract.js";
import type { GuardsHook, PolicyContext, PolicyToolCall } from "../hooks.js";
import { CascadeSession } from "./cascade.js";
import { verifyAfterEdit, withPostEditNote } from "./postEdit.js";
import type { VerifyResult } from "./sourcePolicy.js";
import { isReadOnlyCloudTool } from "./readOnly.js";
import { LINKED_WORK_OPEN } from "../finish/index.js";
import { guardLeversOf, type GuardLevers, type GuardPorts } from "./ports.js";
import { ForcedLadder, ladderTurn } from "./forced/ladder.js";
import type { ForcedTurnResult } from "./forced/types.js";
import type { CacheServedStreak } from "../tools/cacheServedStreak.js";

export { guardLeversOf, type GuardLevers, type GuardPorts };
export { FINISH_RECORD_BRIEF, FINISH_RECORD_TURNS, PROGRESS_FORCED_LABEL } from "./forced/briefs.js";
export type { ForcedLadderState, ForcedTurn, ForcedTurnResult, ProgressBinding, ProgressFacts, ProgressTurnOptions } from "./forced/types.js";

/** A guards session for one run: the levers' state plus the turn's D7 edit verdicts. */
export class RunGuards {
  readonly cascade: CascadeSession;
  private readonly progress: ProgressDetector | null;
  /** A surface's forced-turn ladder (`GuardPorts.progress.turns`); null ⇒ A3's trips keep their generic handling. */
  private readonly forced: ForcedLadder | null;
  private readonly bind: GuardPorts["progress"];
  /** The saved state said the run was finishing (read before any ladder is bound: a resumed tick asks for its tail first). */
  private readonly resumedFinishing: boolean;
  private readonly postEdit: boolean;
  private readonly levers: GuardLevers;
  /** A3's `finish`: the next turn offers no tools — the run's final report. */
  private finishDue: boolean;
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
    const bind = ports.progress;
    this.bind = bind;
    this.progress = levers.a3_progress_detector
      ? new ProgressDetector(resume?.progress, {
          isReadOnly: bind?.isReadOnly ?? ((tool) => isReadOnlyCloudTool(tool)),
          ...(bind?.isUnscopedMutation ? { isUnscopedMutation: bind.isUnscopedMutation } : {}),
          ...(bind?.isPlatformProgress ? { isPlatformProgress: bind.isPlatformProgress } : {}),
          ...(bind?.expectsChange ? { expectsChange: bind.expectsChange } : {}),
        })
      : null;
    // The budgets (plan, change, circling) are the run policy's and hold whether or not A3's detector is on.
    this.forced = bind?.turns ? new ForcedLadder({ ...resume?.forced }, (note) => this.progress?.setSteer(note), bind, bind.turns) : null;
    this.postEdit = !!levers.d7_deterministic_handlers;
    this.finishDue = resume?.finishDue === true;
    this.resumedFinishing = resume?.forced?.finishing === true;
    this.checksNote = resume?.checksNote ?? "";
    this.escalations = resume?.escalations ?? 0;
  }

  /** The volatile-tail sections this turn carries (empty strings drop out). */
  tailSections(): string[] {
    // A finishing run's brief is the whole say of its turns: no steer rides along.
    return [this.finishing || this.resumedFinishing ? "" : this.progress?.steerNote() ?? "", this.cascade.steerNote(), this.checksNote];
  }

  /** The forced-turn ladder's decision for this step, or nothing when none is bound. */
  forcedTurn(ctx: PolicyContext, env: Parameters<NonNullable<GuardsHook["forcedTurn"]>>[1], ports: GuardPorts): Promise<ForcedTurnResult> | undefined {
    return this.forced ? ladderTurn(this.forced, ctx, env, ports.onEvent) : undefined;
  }

  /** A finish turn was decided: sticky for the rest of the run. */
  get finishing(): boolean {
    return this.forced?.finishing === true;
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
      ...(this.finishDue ? { finishDue: true as const } : {}),
      ...(this.forced && Object.keys(this.forced.state).length > 0 ? { forced: { ...this.forced.state } } : {}),
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
      ? { passed: false, verifier: `finish_gates:${verdict.reason ?? "blocked"}`, reason: verdict.block, inconclusive: verdict.reason === "branch_ci_pending" || verdict.reason === "children_running" || verdict.reason === LINKED_WORK_OPEN }
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
    // A child's report that reached the run outside a call (an inbox message): its files are the run's writes.
    for (const report of this.bind?.childReports?.() ?? []) this.progress?.observeChildReport(report);
    const action = this.progress?.endTurn();
    if (action) await this.onTrip(action, ports, step);
  }

  /** Leave a row on the run's timeline. A surface that binds the forced-turn ladder is told the step as well. */
  private async record(ports: GuardPorts, row: { tool: string; detail: Record<string, unknown>; result: string }, step: number): Promise<void> {
    if (this.forced) await ports.onEvent?.(row, { step });
    else await ports.onEvent?.(row);
  }

  private async judge(kind: "finish" | "code_edit", verdict: { passed: boolean; verifier: string; reason?: string; inconclusive?: boolean }, step: number, ports: GuardPorts): Promise<void> {
    const model = ports.model;
    if (!model) return;
    const before = model.get();
    const features = ports.features?.(step, undefined) ?? { actionType: "other" };
    const after = await this.cascade.verdict(before, kind, verdict, {
      ladder: ports.ladder?.() ?? ports.cascade?.ladder ?? { candidates: [], rankOf: () => 1 },
      attemptModel: ports.resolvedModel?.(),
      features: { actionType: this.cascade.featuresActionType(features.actionType ?? "other") },
    });
    if (after === before) return;
    model.set(after);
    if (!verdict.passed) this.escalations += 1;
    await this.record(ports, {
      tool: "model.escalated",
      detail: { step, unit: kind, verifier: verdict.verifier, passed: verdict.passed, from: before.model ?? ports.resolvedModel?.() ?? null, to: after.model ?? null },
      result: verdict.passed
        ? `${kind} passed — back to ${after.model}`
        : `${kind} failed ${verdict.verifier} — escalated to ${after.model}`,
    }, step);
  }

  private async onTrip(action: ProgressAction, ports: GuardPorts, step: number): Promise<void> {
    let outcome: string = action.kind;
    if (action.kind !== "advisory" && this.forced) {
      // The surface's ladder acts on a trip: a steer rides the next turn's opening; an escalation or finish waits for a later
      // turn's menu (`forced/ladder.ts`), where it becomes a forced turn. The row is the one shared mapping, unembellished.
      if (action.kind === "escalate" || action.kind === "finish") this.forced.hold(action);
      const s = progressTraceStep(action);
      await this.record(ports, { tool: s.label, detail: s.args, result: s.result }, step);
      return;
    }
    if (action.kind === "advisory") {
      // B1 readiness / B4 batching: a one-off steer, never a ladder trip — no finish, no
      // escalation. The note rides the next turn's tail (the detector's steer, shown for
      // one turn and persisted across a durable tick), as the editor host does. Still a
      // row on the timeline (the one mapping every host traces through).
      this.progress?.setSteer(action.note);
      const s = progressTraceStep(action);
      await this.record(ports, { tool: s.label, detail: s.args, result: s.result }, step);
      return;
    }
    if (action.kind === "escalate") {
      const model = ports.model;
      const ladder = ports.ladder?.() ?? ports.cascade?.ladder;
      const next = model && ladder ? this.cascade.escalate(model.get(), ladder, ports.resolvedModel?.()) : null;
      if (next && model) {
        model.set(next);
        this.escalations += 1;
      } else {
        // Nothing stronger to move to (or the run is pinned): a second steer, on the same model —
        // the run keeps its chance to finish the work; the third trip ends it on its own report.
        // Never a question for the human (VS Code chat #157440).
        this.progress?.setSteer(progressSteerNote(action.signal, action.trip, false));
        outcome = "steer";
      }
    } else if (action.kind === "finish") {
      // The next turn offers no tools (`finalTurn`) and its tail carries the detector's note
      // (its steer) — the verified wrap-up or the ladder's last rung — so the model reports
      // and the run ends. Never an escalation, never a question for the human.
      this.finishDue = true;
    }
    // The same mapping as the advisory; this host records the outcome it took and the model.
    const s = progressTraceStep(action, {
      outcome,
      detail: { trip: action.trip, signal: action.signal, outcome, model: ports.model?.get().model ?? null },
    });
    await this.record(ports, { tool: s.label, detail: s.args, result: s.result }, step);
  }

  /** A3's `finish`: whether the next turn is the run's final report (no tools). A peek — {@link finalTurnDone} spends it. */
  get finalTurnDue(): boolean {
    return this.finishDue;
  }

  /** The final turn was answered: the finish is spent. */
  finalTurnDone(): void {
    this.finishDue = false;
  }

  /** A3: what the turn said, judged against what its calls did (WS8p). */
  noteTurnText(text: string): void {
    this.progress?.noteTurnText(text);
  }

  /** A3: every dispatched call is observed by the progress detector (when on). */
  observe(call: PolicyToolCall, result: unknown, isError?: boolean): void {
    // A parked call never ran (a control signal), so it is nothing to observe.
    if (result && typeof result === "object" && (result as { control?: unknown }).control) return;
    // The detector reads the outcome shape ({ data, isError? }), not the raw tool
    // result — wrap the dispatched result as the observed data. A surface's text results (a budgeted string) are data too.
    this.progress?.observe(call.name, call.args, { data: result, ...(isError ? { isError: true } : {}) });
  }
}

// ── The composition's hook ───────────────────────────────────────────────────

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
 * The ports a hook call runs with: the surface's own, with the run's STATE bound in. The model get/set default to
 * `ctx.state.model` (so a surface never needs a live-state side channel) and `features` is handed the state; a model default
 * is bound only when a tier ladder is, because a cascade with no ladder has nothing to move along.
 */
function portsOf(ctx: PolicyContext, ports: GuardPorts): GuardPorts {
  const state = ctx.state;
  const ladder = ports.ladder?.() ?? ports.cascade?.ladder;
  return {
    ...ports,
    ...(!ports.model && ladder ? { model: { get: () => state.model, set: (next: RunState["model"]) => { state.model = next; } } } : {}),
    ...(ports.features ? { features: (step: number) => ports.features!(step, state) } : {}),
  };
}

/**
 * The guards hook for a surface's engine couplings. It has no `beforeDispatch`: A3 never
 * parks the run on a human question (its last rung is `finish`); `observe` runs the D7 post-edit
 * check on the result and feeds the D1 cascade + A3 progress detector; `endTurn` folds
 * the turn — the turn's text first, so an unkept readiness claim counts (WS8p);
 * `isReadOnly` is D8's port, which the composition hands the kernel.
 *
 * The levers come from `RunPolicy.levers`, never from the entry point. The ports are the
 * surface's: an adapter binds them with `composePolicyHooks({ guards: createGuardsHook(ports) })`.
 * `RunGuards` also exposes `isReadOnly` (the D8 port) for the composition.
 */
export function createGuardsHook(surfacePorts: GuardPorts = {}): GuardsHook {
  return {
    async observe(ctx: PolicyContext, call: PolicyToolCall, result: unknown, isError?: boolean) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      const noted = await g.checkEdit(call, result, ports);
      g.observe(call, result, isError);
      ctx.state.guards = g.snapshot();
      // D7: a failed post-edit check reaches the model on that call's own result.
      return noted !== result ? { data: noted } : undefined;
    },
    async endTurn(ctx: PolicyContext, content: string) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      // The turn's text as the surface reads it (reasoning included, `DeliveryLedger.judged`), against what its calls did.
      g.noteTurnText(ctx.ports.delivery?.judged?.(content) ?? content);
      await g.endTurn(ctx.step, ports);
      ctx.state.guards = g.snapshot();
    },
    async forcedTurn(ctx: PolicyContext, env: { select(): Promise<readonly ToolSchema[]>; cache: CacheServedStreak }) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      const decided = await g.forcedTurn(ctx, env, ports);
      ctx.state.guards = g.snapshot();
      return decided;
    },
    isFinishing(ctx: PolicyContext) {
      return sessionOf(ctx, portsOf(ctx, surfacePorts)).finishing;
    },
    isReadOnly(ctx: PolicyContext, name: string) {
      const ports = portsOf(ctx, surfacePorts);
      return sessionOf(ctx, ports).isReadOnly(name);
    },
    finalTurn(ctx: PolicyContext) {
      const ports = portsOf(ctx, surfacePorts);
      return sessionOf(ctx, ports).finalTurnDue;
    },
    finalTurnDone(ctx: PolicyContext) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      g.finalTurnDone();
      ctx.state.guards = g.snapshot();
    },
    async seed(ctx: PolicyContext) {
      const ports = portsOf(ctx, surfacePorts);
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
      const ports = portsOf(ctx, surfacePorts);
      return sessionOf(ctx, ports).reasoning(undefined);
    },
    async finish(ctx: PolicyContext, verdict: { block: string | null; reason?: string }) {
      const ports = portsOf(ctx, surfacePorts);
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

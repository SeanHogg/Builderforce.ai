/**
 * The cloud loop's in-run GUARDS, wired onto the kernel's hooks and ports in one place
 * so `cloudAgentEngine.ts` adds a wrap call instead of growing:
 *
 *  - A3 progress detector (`a3_progress_detector`): every dispatched call is observed;
 *    a stuck turn trips it — first a steer in the trailing volatile block, then one
 *    model tier up, then a pause on a human question (`ask_human`, the same park the
 *    governance gate uses).
 *  - D7 post-edit check (`d7_deterministic_handlers`): a write/edit is checked the moment
 *    it lands; only a failure reaches the model, as one note on that tool result. A run
 *    with a sandbox also runs the project's own fast checks over the turn's edits there;
 *    their failures ride the next turn's volatile tail.
 *  - D1 verifier cascade (`d1_verifier_cascade`): a turn's edits and every finish attempt
 *    are units with a verifier; a failure moves the run one tier up (`CascadeSession`).
 *  - D8 concurrent reads (`d8_parallel_tool_calls`): the kernel's `isReadOnly` port.
 *
 * Everything that must survive a durable tick rides {@link LoopGuardState}, which
 * `CostLoopState` extends. Each lever off ⇒ its part is inert and the hook / port is the
 * engine's own, unchanged.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { LoopHooks, LoopPorts } from '@builderforce/agent-loop';
import { ProgressDetector, progressPauseQuestion, type ProgressAction, type ProgressDetectorState } from '@builderforce/run-guards';
import type { CascadeUnitKind, CascadeVerdict, TierLadder } from '@builderforce/run-policy';
import type { DifficultyFeatures } from '@builderforce/difficulty-router';
import type { AgentExecParams } from '@builderforce/agent-tools';
import type { Db } from '../../../infrastructure/database/connection';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import type { VerifyResult } from '../../repos/verifyWrittenFiles';
import type { CloudRunModelState, CloudRunRef } from '../cloudAgent/cloudRunModelPolicy';
import { isInconclusiveFinishBlock, type FinishGateVerdict } from '../cloudAgent/finishGates';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { CascadeSession, type CascadeSessionState } from './verifierCascade';
import { verifyAfterEdit, withPostEditNote } from './postEditVerify';
import { isReadOnlyCloudTool, readOnlyDispatchPort } from './parallelReads';
import type { RunSandbox } from '../sandbox/runSandbox';

/** What the guards persist across durable ticks (spread into `CloudLoopState`). */
export interface LoopGuardState {
  /** A3: the progress detector's tallies and trip count. */
  progress?: ProgressDetectorState;
  /** D1: the cascade's units, the first tick's action type, the seed's softness. */
  cascade?: CascadeSessionState;
  /** A3: a pause the next dispatched call parks the run on. */
  pendingPause?: string;
  /** D7: the sandbox checks' failures, for the NEXT turn's tail. A durable tick runs one
   *  step, so the turn that reads this note runs in the next tick's guards. */
  checksNote?: string;
}

/** What the guards need from the engine — live views of its run state. */
export interface LoopGuardDeps {
  db: Db;
  evt: CloudRunRef;
  /** The run's policy role (stamped on cascade training rows). */
  role: string;
  /** The role's tier ladder (`cloudTierLadder`). */
  ladder: TierLadder;
  /** The ticket repo (null when none is bound). */
  repoCtx: TicketRepoContext | null;
  /** The engine's model hand-off state — read and replaced, never copied. */
  model: { get(): CloudRunModelState; set(next: CloudRunModelState): void };
  /** What answered the latest turn. */
  resolvedModel(): string | undefined;
  /** D2 features of the step about to be judged (everything but the action type, which the cascade keeps). */
  features(turnIndex: number): DifficultyFeatures;
  /** Park the run on a human question (the engine's `pauseExecutionForQuestion`). */
  pause(question: string): Promise<{ approvalId: string }>;
  /** The run's sandbox, when it has one: the project's own fast checks over the clone. */
  sandbox?: Pick<RunSandbox, 'checks'>;
}

export class LoopGuards {
  readonly cascade: CascadeSession;
  private readonly progress: ProgressDetector | null;
  private readonly postEdit: boolean;
  private readonly readPort: ReturnType<typeof readOnlyDispatchPort>;
  private pendingPause: string | undefined;
  /** This turn's post-edit verdicts — the D1 code unit's verifier. */
  private turnEdits: VerifyResult[] = [];
  /** D7: the sandbox checks' failures from the last turn, for the next turn's tail. */
  private checksNote = '';
  /** What the current turn said — A3 judges a readiness claim against its calls (PRD 35 WS8p). */
  private turnText = '';

  constructor(env: unknown, tenantId: number, resume?: LoopGuardState, db?: unknown) {
    this.cascade = new CascadeSession(env, tenantId, resume?.cascade, db);
    this.progress = isCostLeverOn(env, 'a3_progress_detector', tenantId)
      ? new ProgressDetector(resume?.progress, { isReadOnly: (tool) => isReadOnlyCloudTool(tool) })
      : null;
    this.postEdit = isCostLeverOn(env, 'd7_deterministic_handlers', tenantId);
    this.readPort = readOnlyDispatchPort(env, tenantId);
    this.pendingPause = resume?.pendingPause;
    this.checksNote = resume?.checksNote ?? '';
  }

  /** The volatile-tail sections this turn carries (empty strings drop out). */
  tailSections(): string[] {
    return [this.progress?.steerNote() ?? '', this.cascade.steerNote(), this.checksNote];
  }

  /** D1: the reasoning levers for a turn, raised while a unit is escalated. */
  reasoning(base: AgentExecParams | undefined, role: unknown): AgentExecParams | undefined {
    return this.cascade.execParams(base, role);
  }

  /** D1 + D2: the first tick's starting model (weak-first unless the router says skip). */
  seedModel(state: CloudRunModelState, a: { strict: boolean; ladder: TierLadder; features: DifficultyFeatures }): Promise<CloudRunModelState> {
    return this.cascade.seed(state, a);
  }

  snapshot(): LoopGuardState {
    return {
      ...(this.progress ? { progress: this.progress.snapshot() } : {}),
      // The cascade's seed facts serve A3's escalation too; with both levers off nothing persists.
      ...(this.cascade.on || this.progress ? { cascade: this.cascade.snapshot() } : {}),
      ...(this.pendingPause ? { pendingPause: this.pendingPause } : {}),
      ...(this.checksNote ? { checksNote: this.checksNote } : {}),
    };
  }

  /** The engine's hooks and ports, with the guards around them. */
  wrap<M>(hooks: LoopHooks<M>, ports: LoopPorts<M>, deps: LoopGuardDeps): { hooks: LoopHooks<M>; ports: LoopPorts<M> } {
    const verifyEdits = this.postEdit || this.cascade.on;
    return {
      ports: {
        ...ports,
        ...this.readPort,
        dispatch: async (call, ctx) => {
          const result = await ports.dispatch(call, ctx);
          if (!verifyEdits) return result;
          const verdict = await verifyAfterEdit(call, result.data, deps.repoCtx);
          if (!verdict) return result;
          this.turnEdits.push(verdict);
          return this.postEdit ? { ...result, data: withPostEditNote(result.data, verdict) } : result;
        },
      },
      hooks: {
        ...hooks,
        beforeDispatch: async (call, ctx) => {
          if (this.pendingPause) {
            const question = this.pendingPause;
            this.pendingPause = undefined;
            const { approvalId } = await deps.pause(question);
            return { result: { data: { ok: false, error: `Paused for a human: ${question}` }, control: { kind: 'ask_human', approvalId, question } } };
          }
          return hooks.beforeDispatch?.(call, ctx);
        },
        afterDispatch: async (call, result, message, ctx) => {
          const decision = await hooks.afterDispatch?.(call, result, message, ctx);
          if (!result.control) this.progress?.observe(call.name, call.args, result);
          return decision;
        },
        afterTurn: async (ctx, turn) => {
          this.turnText = turn.content ?? '';
          return hooks.afterTurn?.(ctx, turn);
        },
        afterToolCalls: async (ctx, finished) => {
          const decision = await hooks.afterToolCalls?.(ctx, finished);
          await this.endTurn(ctx.step, deps);
          return decision;
        },
      },
    };
  }

  /** D1: fold a finish attempt's gate verdict into the cascade; returns the block the kernel reads. */
  async finish(verdict: FinishGateVerdict, step: number, deps: LoopGuardDeps): Promise<string | null> {
    if (this.cascade.on) {
      const v: CascadeVerdict = verdict.block
        ? { passed: false, verifier: `finish_gates:${verdict.reason ?? 'blocked'}`, reason: verdict.block, inconclusive: isInconclusiveFinishBlock(verdict.reason) }
        : { passed: true, verifier: 'finish_gates' };
      await this.judge('finish', v, step, deps);
    }
    return verdict.block;
  }

  private async endTurn(step: number, deps: LoopGuardDeps): Promise<void> {
    this.checksNote = '';
    this.progress?.noteTurnText(this.turnText);
    this.turnText = '';
    if (this.turnEdits.length > 0) {
      const errors = this.turnEdits.flatMap((v) => v.errors);
      this.turnEdits = [];
      const staticVerdict: CascadeVerdict = errors.length
        ? { passed: false, verifier: 'changed_files', reason: errors.slice(0, 5).map((e) => `${e.path}${e.line ? `:${e.line}` : ''} ${e.message}`).join('; ') }
        : { passed: true, verifier: 'changed_files' };
      // With a sandbox the project's own checks (typecheck / lint / tests on what changed)
      // also judge the turn: a stronger verifier than the static read of each file.
      const checks = deps.sandbox ? await deps.sandbox.checks().catch(() => null) : null;
      if (checks?.steer && this.postEdit) this.checksNote = checks.steer;
      const verdict: CascadeVerdict = checks && !checks.passed && staticVerdict.passed
        ? { passed: false, verifier: checks.verifier, ...(checks.reason ? { reason: checks.reason } : {}) }
        : staticVerdict;
      await this.judge('code_edit', verdict, step, deps);
    }
    this.cascade.endTurn();
    const action = this.progress?.endTurn();
    if (action) await this.onTrip(action, deps);
  }

  private async judge(kind: CascadeUnitKind, verdict: CascadeVerdict, step: number, deps: LoopGuardDeps): Promise<void> {
    const before = deps.model.get();
    const features = deps.features(step);
    const after = await this.cascade.verdict(before, kind, verdict, {
      db: deps.db, tenantId: deps.evt.tenantId, executionId: deps.evt.executionId, role: deps.role, ladder: deps.ladder,
      attemptModel: deps.resolvedModel(), features: { ...features, actionType: this.cascade.featuresActionType(features.actionType) },
    });
    if (after === before) return;
    deps.model.set(after);
    await recordCloudToolEvent(deps.db, {
      ...deps.evt, toolName: 'model.escalated', category: 'llm',
      detail: { step, unit: kind, verifier: verdict.verifier, passed: verdict.passed, from: before.policy.model ?? deps.resolvedModel() ?? null, to: after.policy.model ?? null },
      result: verdict.passed
        ? `${kind} passed — back to ${after.policy.model}`
        : `${kind} failed ${verdict.verifier} — escalated to ${after.policy.model}`,
    });
  }

  private async onTrip(action: ProgressAction, deps: LoopGuardDeps): Promise<void> {
    let outcome: string = action.kind;
    if (action.kind === 'escalate') {
      const next = this.cascade.escalate(deps.model.get(), deps.ladder, deps.resolvedModel());
      if (next) deps.model.set(next);
      else {
        // Nothing stronger to move to (or the run is pinned): the second trip pauses,
        // and its "moved to a stronger model" steer would be untrue.
        this.pendingPause = progressPauseQuestion(action.signal, action.trip);
        this.progress?.setSteer(undefined);
        outcome = 'pause';
      }
    } else if (action.kind === 'pause') {
      this.pendingPause = action.question;
    }
    await recordCloudToolEvent(deps.db, {
      ...deps.evt, toolName: 'loop.progress_check', category: 'llm',
      detail: { trip: action.trip, signal: action.signal, outcome, model: deps.model.get().policy.model ?? null },
      result: `progress check ${action.trip}: ${action.signal.kind} → ${outcome}`,
    });
  }
}

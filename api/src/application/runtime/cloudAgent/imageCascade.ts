/**
 * D1 — the weak-first verifier cascade on the IMAGE surfaces (lever `d1_verifier_cascade`).
 *
 * An image (the Cloudflare Container) runs its own tool loop but makes NO model decision:
 * every turn is the Worker's `llm` op (`imageRunTurn`), which owns the run's model policy.
 * So the cascade lives here, in the op, around the SAME `CascadeSession` the durable loop
 * folds its verdicts into — nothing about the decisions is re-implemented:
 *
 *   • the image's verifier is its post-edit fast checks (`container/postEditChecks.mjs`):
 *     it drains them before each turn and sends the verdict on the `llm` op as `checks`;
 *   • the FIRST turn starts a soft seed on the weakest tier of the ladder (unless the D2
 *     router predicts the weak attempt fails, or the pick is a strict pin);
 *   • a later turn folds the previous turn's verdict: a failure moves the run one tier up
 *     for THIS turn (with the cascade's steer and a reasoning boost), a pass after an
 *     escalation steps it back down — the run policy's `escalated` event either way.
 *
 * An image only gets weak-first when it HAS a verifier: `checks` is present on the op
 * (null when nothing was judged) exactly while the image runs post-edit checks. The
 * Actions runner sends no `checks`, so it is never started weak with nothing to catch a
 * weak model's mistakes. Lever off ⇒ nothing here runs and no state is read or written.
 *
 * Cascade state rides beside the model state in the Worker's cache, keyed by execution
 * (`containerRunModelStore.ts`), since the image holds nothing the Worker can trust.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { DifficultyFeatures } from '@builderforce/difficulty-router';
import type { AgentExecParams, ToolSchema } from '@builderforce/agent-tools';
import type { CascadeVerdict, TierLadder } from '@builderforce/run-policy';
import { classifyRunAction } from '@builderforce/workload';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { estimateRequestTokens } from '../../llm/LlmProxyService';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { CascadeSession } from '../costLoop/verifierCascade';
import type { CloudRunModelState } from './cloudRunModelPolicy';
import { loadContainerRunCascade, saveContainerRunCascade } from './containerRunModelStore';

/**
 * The image's `checks` field off an `llm` op. `undefined` ⇒ this image runs no verifier;
 * `null` ⇒ it does, and nothing was judged since the last turn; else the verdict.
 */
export function readImageCheckVerdict(value: unknown): CascadeVerdict | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.passed !== 'boolean') return null;
  const verifier = typeof v.verifier === 'string' && v.verifier.trim() ? v.verifier.trim().slice(0, 64) : 'post_edit_checks';
  const reason = typeof v.reason === 'string' && v.reason.trim() ? v.reason.trim().slice(0, 2_000) : undefined;
  return { passed: v.passed, verifier, ...(reason ? { reason } : {}) };
}

/** A turn's D2 features on an image surface — the same contract the durable loop records. */
export function imageTurnFeatures(
  task: { taskTitle: string; taskDescription: string | null },
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: readonly ToolSchema[],
  role: string,
): DifficultyFeatures {
  return {
    actionType: classifyRunAction([task.taskTitle, task.taskDescription ?? ''].join('\n\n')).actionType,
    role,
    promptTokens: estimateRequestTokens(messages, tools),
    toolCount: tools.length,
    turnIndex: messages.filter((m) => m.role === 'assistant').length,
  };
}

export interface ImageCascadeRun {
  env: Env;
  db: Db;
  tenantId: number;
  executionId: number;
  cloudAgentRef: string | undefined;
  /** The turn's policy role (`cloudRunRole`). */
  role: string;
  ladder: TierLadder;
  features: DifficultyFeatures;
}

export class ImageCascade {
  private constructor(
    private readonly run: ImageCascadeRun,
    private readonly checks: CascadeVerdict | null,
    private readonly session: CascadeSession,
    private readonly attemptModel: string | undefined,
  ) {}

  /** The cascade for this turn, or null (lever off, or an image with no verifier). */
  static async open(run: ImageCascadeRun, checks: CascadeVerdict | null | undefined): Promise<ImageCascade | null> {
    if (checks === undefined || !isCostLeverOn(run.env, 'd1_verifier_cascade', run.tenantId)) return null;
    const saved = await loadContainerRunCascade(run.env, run.executionId);
    return new ImageCascade(run, checks, new CascadeSession(run.env, run.tenantId, saved?.cascade, run.db), saved?.resolvedModel);
  }

  /** First turn: a soft seed starts on the weak tier (D2 may keep the stronger seed). */
  seed(state: CloudRunModelState, strict: boolean): Promise<CloudRunModelState> {
    return this.session.seed(state, { strict, ladder: this.run.ladder, features: this.run.features });
  }

  /** A later turn: fold the previous turn's post-edit verdict, when the image sent one. */
  async fold(state: CloudRunModelState): Promise<CloudRunModelState> {
    if (!this.checks) return state;
    const { run } = this;
    const after = await this.session.verdict(state, 'code_edit', this.checks, {
      db: run.db, tenantId: run.tenantId, executionId: run.executionId, role: run.role, ladder: run.ladder,
      attemptModel: this.attemptModel,
      features: { ...run.features, actionType: this.session.featuresActionType(run.features.actionType) },
    });
    if (after !== state) {
      await recordCloudToolEvent(run.db, {
        tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId: run.executionId,
        toolName: 'model.escalated', category: 'llm',
        detail: { step: run.features.turnIndex, unit: 'code_edit', verifier: this.checks.verifier, passed: this.checks.passed, from: state.policy.model ?? this.attemptModel ?? null, to: after.policy.model ?? null },
        result: this.checks.passed
          ? `code_edit passed — back to ${after.policy.model}`
          : `code_edit failed ${this.checks.verifier} — escalated to ${after.policy.model}`,
      });
    }
    return after;
  }

  /** The cascade's note for this turn's request ("" when none). */
  steerNote(): string {
    return this.session.steerNote();
  }

  /** The turn's reasoning levers, raised one level per open escalation. */
  reasoning(base: AgentExecParams | undefined, role: unknown): AgentExecParams | undefined {
    return this.session.execParams(base, role);
  }

  /** The turn ended: persist the cascade and the model the attempt actually ran on. */
  async end(resolvedModel: string | undefined): Promise<void> {
    this.session.endTurn();
    const model = resolvedModel ?? this.attemptModel;
    await saveContainerRunCascade(this.run.env, this.run.executionId, { cascade: this.session.snapshot(), ...(model ? { resolvedModel: model } : {}) });
  }
}

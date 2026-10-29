/**
 * The cloud run's CONTAINMENT session (cost levers A2 and D5), one per tick (PRD 35 WS3).
 *
 * What this session decides is whether the run may buy its NEXT paid turn: the declared limits
 * (files, repositories, spend) and the A2 token cap against what the run has spent so far, the
 * budget line the model reads in its per-turn tail, and the D5 per-role cap on a reply. It is
 * HOST work — the ledger and the team alert are the cloud's. Everything that shapes a turn (the
 * tool catalog, the volatile tail, compaction, the task state, the guards) is the one agent's
 * (`@builderforce/agent-run`).
 *
 * Every lever is read once per tick through `isCostLeverOn`; with a lever off, its part of the
 * session reproduces the behaviour from before the lever existed. What must survive durable
 * ticks rides {@link CostLoopState}.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import { cappedMaxTokens } from '@builderforce/run-policy';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import type { ProxyResult } from '../../llm/proxyTypes';
import { checkRunLimits, type RunLimits } from '../../../domain/containment/runLimits';
import { ledgerRunSpend, readRunTokenCap, renderBudget, turnSpend, type RunSpend } from './runBudget';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { notifyContainmentStop } from '../../alerts/containmentAlert';

/** What the containment session persists across durable ticks. */
export interface CostLoopState {
  /** A2: this run's platform spend so far (millicents) — replaces the per-turn ledger SUM. */
  spentMillicents?: number;
  /** A2: prompt + completion tokens this run has consumed (BYO turns included). */
  tokensUsed?: number;
  /** A2: the run's token cap, resolved once on the first tick. */
  tokenCap?: number;
}

type Declared = Pick<RunLimits, 'maxFiles' | 'maxRepositories' | 'maxSpendMillicents'>;

export interface CostLoopSessionArgs {
  env: Env;
  db: Db;
  tenantId: number;
  executionId: number;
  /** The ticket the run works — named in the containment alert. */
  taskId?: number | null;
  /** Where this run's tokens bill — a delegated child's are its parent's. */
  meterExecutionId: number;
  plan: string;
  /** The run's policy role (explore / code / verify / plan / …). */
  role: string;
  resume?: CostLoopState;
  /** Timeline writer (`recordCloudToolEvent` bound to this run). */
  record: (toolName: string, category: string, detail: Record<string, unknown>, result: string) => Promise<void>;
}

export class CostLoopSession {
  private readonly outputCaps: boolean;
  private readonly budgetOn: boolean;
  private readonly child: boolean;
  private spend: RunSpend | undefined;
  private budgetLine = '';

  constructor(private readonly a: CostLoopSessionArgs, private readonly tokenCap: number | undefined) {
    this.outputCaps = isCostLeverOn(a.env, 'd5_output_caps', a.tenantId);
    this.budgetOn = tokenCap !== undefined;
    this.child = a.meterExecutionId !== a.executionId;
    const r = a.resume;
    // A2 running totals, carried tick to tick. Seeded from ONE ledger read on the first
    // turn (so prep spend counts), and re-read every turn when A2 is off (the pre-A2
    // check) or for a child, whose limit is the whole tree's.
    this.spend = this.budgetOn && !this.child && r?.spentMillicents != null && r.tokensUsed != null
      ? { spentMillicents: r.spentMillicents, tokensUsed: r.tokensUsed }
      : undefined;
  }

  /**
   * The pre-turn containment check. Lever off: the declared limits against the ledger
   * SUM, exactly as before. On: the token cap joins the limits and the spend comes from
   * the running totals. Returns the run's stop output, or null to proceed. `progress` is the
   * agent's rendered task state — a contained run tells a follow-up where to resume.
   */
  async beforeTurn(step: number, declared: Declared | undefined, files: number, repositories: number, progress = ''): Promise<string | null> {
    if (!this.budgetOn && !declared) return null;
    if (!this.budgetOn || this.child || !this.spend) {
      // Lever off, or a declared limit depends on it: the pre-A2 read, failures and all.
      // Otherwise a failed seed counts the token budget from 0 rather than failing the run.
      this.spend = await ledgerRunSpend(this.a.db, this.a.tenantId, this.a.meterExecutionId).catch((error: unknown) => {
        if (!this.budgetOn || declared) throw error;
        reportCaughtError(error, { source: 'application/runtime/costLoop/costLoopSession.ts', operation: 'beforeTurn.ledgerRunSpend' });
        return { spentMillicents: 0, tokensUsed: 0 };
      });
    }
    const limits: RunLimits = {
      ...(declared ?? { maxFiles: null, maxRepositories: null, maxSpendMillicents: null }),
      ...(this.budgetOn ? { maxTokens: this.tokenCap } : {}),
    };
    const usage = { files, repositories, spendMillicents: this.spend.spentMillicents, ...(this.budgetOn ? { tokens: this.spend.tokensUsed } : {}) };
    this.budgetLine = this.budgetOn ? renderBudget(limits, usage) : '';
    const reason = checkRunLimits(limits, usage);
    if (!reason) return null;
    await this.a.record('containment.limit', 'tool', { step, limits: this.budgetOn ? limits : declared }, reason);
    // The push half of the stop: the timeline event above is the evidence, this tells the
    // team (once per run — the alert's cooldown is keyed on the execution; never throws).
    await notifyContainmentStop(this.a.env, this.a.db, {
      tenantId: this.a.tenantId, executionId: this.a.executionId, taskId: this.a.taskId ?? null,
      reason, spendMillicents: usage.spendMillicents,
    });
    return `Run contained: ${reason}.${this.budgetOn && progress ? `\n\nProgress so far — a follow-up run can resume from here:\n${progress}` : ''}`;
  }

  /**
   * The A2 budget line for this turn's volatile tail, rendered from the run's CURRENT totals — a resumed tick knows them the
   * moment the session opens, so the line reaches the model on every turn instead of one turn late. '' when the budget lever
   * is off or the totals are not known yet (a first turn, or a child billed to its parent).
   */
  budgetNote(declared?: Declared, files = 0, repositories = 0): string {
    if (!this.budgetOn || !this.spend) return this.budgetLine;
    const limits: RunLimits = { ...(declared ?? { maxFiles: null, maxRepositories: null, maxSpendMillicents: null }), maxTokens: this.tokenCap };
    return renderBudget(limits, { files, repositories, spendMillicents: this.spend.spentMillicents, tokens: this.spend.tokensUsed });
  }

  /** The reply cap for this turn: D5's per-role cap under the caller's, else the caller's. */
  turnFields(callerMaxTokens: number | undefined): { max_tokens?: number } {
    const maxTokens = this.outputCaps ? cappedMaxTokens(this.a.role, callerMaxTokens) : callerMaxTokens;
    return maxTokens != null ? { max_tokens: maxTokens } : {};
  }

  /** Fold one turn's usage into the A2 running totals. */
  async recordTurn(result: Pick<ProxyResult, 'usage' | 'resolvedModel' | 'byoFunded'>): Promise<void> {
    if (!this.budgetOn || this.child || !this.spend) return;
    const t = await turnSpend(this.a.env, result);
    this.spend = { spentMillicents: this.spend.spentMillicents + t.spentMillicents, tokensUsed: this.spend.tokensUsed + t.tokensUsed };
  }

  /** What the next durable tick resumes from. */
  snapshot(): CostLoopState {
    return {
      ...(this.budgetOn && this.spend && !this.child ? { ...this.spend } : {}),
      ...(this.budgetOn ? { tokenCap: this.tokenCap } : {}),
    };
  }
}

/** Open the session for one tick (A2 resolves the run's token cap once, on the first). */
export async function openCostLoopSession(args: CostLoopSessionArgs): Promise<CostLoopSession> {
  const budgetOn = isCostLeverOn(args.env, 'a2_run_budget', args.tenantId);
  const tokenCap = budgetOn
    ? args.resume?.tokenCap ?? await readRunTokenCap(args.db, args.tenantId, args.executionId, args.plan)
    : undefined;
  return new CostLoopSession(args, tokenCap);
}

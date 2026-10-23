/**
 * The cloud loop's COST LEVERS, as one per-tick session the engine wires with a few
 * lines (it must not grow): which tools a turn advertises (C1), the request messages
 * with the volatile tail (B1), compaction extras (C2 masking + the task-brief pin),
 * the `tool_search` / `update_task_state` meta tools (C1 / C3), the per-role output cap
 * (D5) and the run budget (A2).
 *
 * Every lever is read once per tick through `isCostLeverOn`; with a lever off, its
 * part of the session reproduces the engine's behaviour from before the lever existed.
 * What must survive durable ticks rides {@link CostLoopState} (spread into
 * `CloudLoopState`).
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import { cappedMaxTokens } from '@builderforce/run-policy';
import type { ToolSchema } from '@builderforce/agent-tools';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import type { ProxyResult } from '../../llm/proxyTypes';
import { toolsTokensOf, OBSERVATION_MASK_TURNS, type CompactOptions } from '../../llm/compactMessages';
import { checkRunLimits, type RunLimits } from '../../../domain/containment/runLimits';
import {
  TOOL_SEARCH_SCHEMA, TOOL_SEARCH_TOOL, advertisedTools, deferredToolRole, promptNamedTools, runToolSearch, type DeferredToolRole,
} from './deferredTools';
import { UPDATE_TASK_STATE_SCHEMA, UPDATE_TASK_STATE_TOOL, applyTaskStateUpdate, renderTaskState, type TaskState } from './taskState';
import { ledgerRunSpend, readRunTokenCap, renderBudget, turnSpend, type RunSpend } from './runBudget';
import { turnRequestMessages } from './volatileTail';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { notifyContainmentStop } from '../../alerts/containmentAlert';

/** What the cost levers persist across durable ticks. */
export interface CostLoopState {
  /** C1: tools loaded beyond the role core set (prompt-named, searched, or called). */
  loadedTools?: string[];
  /** C3: the agent's structured task state. */
  taskState?: TaskState;
  /** A2: this run's platform spend so far (millicents) — replaces the per-turn ledger SUM. */
  spentMillicents?: number;
  /** A2: prompt + completion tokens this run has consumed (BYO turns included). */
  tokensUsed?: number;
  /** A2: the run's token cap, resolved once on the first tick. */
  tokenCap?: number;
}

type Msg = Record<string, unknown>;
type Declared = Pick<RunLimits, 'maxFiles' | 'maxRepositories' | 'maxSpendMillicents'>;
type MetaResult = { data: unknown; isError?: boolean };

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
  /** Every tool this run may call (core + curated platform). */
  catalog: readonly ToolSchema[];
  resume?: CostLoopState;
  /** The system prompt + task brief — tools they name are loaded up front under C1. */
  promptTexts: readonly string[];
  /** Tools the run cannot finish without (e.g. a reviewer's sign-off tool). */
  required?: readonly string[];
  /** Timeline writer (`recordCloudToolEvent` bound to this run). */
  record: (toolName: string, category: string, detail: Record<string, unknown>, result: string) => Promise<void>;
}

export class CostLoopSession {
  readonly stablePrefix: boolean;
  private readonly deferred: boolean;
  private readonly masking: boolean;
  private readonly taskStateOn: boolean;
  private readonly outputCaps: boolean;
  private readonly budgetOn: boolean;
  private readonly child: boolean;
  private readonly toolRole: DeferredToolRole;
  private readonly loaded: Set<string>;
  private taskState: TaskState | undefined;
  private spend: RunSpend | undefined;
  private budgetLine = '';
  private toolsSignature = '';

  constructor(private readonly a: CostLoopSessionArgs, private readonly tokenCap: number | undefined) {
    const on = (id: Parameters<typeof isCostLeverOn>[1]) => isCostLeverOn(a.env, id, a.tenantId);
    this.stablePrefix = on('b1_stable_prefix');
    this.deferred = on('c1_deferred_tools');
    this.masking = on('c2_observation_masking');
    this.taskStateOn = on('c3_task_state');
    this.outputCaps = on('d5_output_caps');
    this.budgetOn = tokenCap !== undefined;
    this.child = a.meterExecutionId !== a.executionId;
    this.toolRole = deferredToolRole(a.role);
    this.loaded = new Set(a.resume?.loadedTools ?? [...promptNamedTools(a.catalog, a.promptTexts), ...(a.required ?? [])]);
    this.taskState = a.resume?.taskState;
    const r = a.resume;
    // A2 running totals, carried tick to tick. Seeded from ONE ledger read on the first
    // turn (so prep spend counts), and re-read every turn when A2 is off (the pre-A2
    // check) or for a child, whose limit is the whole tree's.
    this.spend = this.budgetOn && !this.child && r?.spentMillicents != null && r.tokensUsed != null
      ? { spentMillicents: r.spentMillicents, tokensUsed: r.tokensUsed }
      : undefined;
  }

  private meta(): ToolSchema[] {
    return [...(this.deferred ? [TOOL_SEARCH_SCHEMA] : []), ...(this.taskStateOn ? [UPDATE_TASK_STATE_SCHEMA] : [])];
  }

  /** The tools to advertise this turn. */
  tools(): ToolSchema[] {
    return this.deferred
      ? advertisedTools(this.a.catalog, this.toolRole, this.loaded, this.meta())
      : [...this.a.catalog, ...this.meta()];
  }

  /** Compaction extras: the advertised tools, C2 masking, the task-brief pin (C3), and the
   *  env + tenant the C9 price-tier budget is decided for. */
  compactOptions(): Pick<CompactOptions, 'tools' | 'maskObservationsAfterTurns' | 'pinTaskBrief' | 'env' | 'tenantId'> {
    return {
      tools: this.tools(),
      env: this.a.env,
      tenantId: this.a.tenantId,
      ...(this.masking ? { maskObservationsAfterTurns: OBSERVATION_MASK_TURNS } : {}),
      ...(this.taskStateOn ? { pinTaskBrief: true } : {}),
    };
  }

  /**
   * The pre-turn containment check. Lever off: the declared limits against the ledger
   * SUM, exactly as before. On: the token cap joins the limits and the spend comes from
   * the running totals. Returns the run's stop output, or null to proceed.
   */
  async beforeTurn(step: number, declared: Declared | undefined, files: number, repositories: number): Promise<string | null> {
    await this.recordToolsChange(step);
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
    const progress = this.budgetOn ? renderTaskState(this.taskState) : '';
    return `Run contained: ${reason}.${progress ? `\n\nProgress so far — a follow-up run can resume from here:\n${progress}` : ''}`;
  }

  /** The request messages for this turn (B1 volatile tail; the budget line + task state ride it). */
  turnMessages(messages: readonly Msg[], dynamicSystem?: string): Msg[] {
    return turnRequestMessages(messages, {
      stablePrefix: this.stablePrefix,
      ...(dynamicSystem ? { dynamicSystem } : {}),
      sections: [this.budgetLine, this.taskStateOn ? renderTaskState(this.taskState) : ''],
    });
  }

  /** The reply cap for this turn: D5's per-role cap under the caller's, else the caller's. */
  turnFields(callerMaxTokens: number | undefined): { max_tokens?: number } {
    const maxTokens = this.outputCaps ? cappedMaxTokens(this.a.role, callerMaxTokens) : callerMaxTokens;
    return maxTokens != null ? { max_tokens: maxTokens } : {};
  }

  /** Handle a meta tool (`tool_search` / `update_task_state`); undefined = not ours. */
  dispatch(call: { name: string; args: Record<string, unknown> }): MetaResult | undefined {
    if (this.deferred && call.name === TOOL_SEARCH_TOOL) {
      const advertised = new Set(this.tools().map((t) => t.function.name));
      const found = runToolSearch(this.a.catalog, advertised, call.args);
      for (const name of found.load) this.loaded.add(name);
      return { data: found.data, ...(found.load.length || found.data.ok ? {} : { isError: true }) };
    }
    if (this.taskStateOn && call.name === UPDATE_TASK_STATE_TOOL) {
      const r = applyTaskStateUpdate(this.taskState, call.args);
      if (!r.ok) return { data: { ok: false, error: r.error }, isError: true };
      this.taskState = r.state;
      return { data: { ok: true, note: 'Task state saved — it is shown to you every turn and kept through compaction.' } };
    }
    // A deferred tool the model called anyway (the guard still decides if it may) stays
    // advertised from now on, so the transcript never cites a tool the request omits.
    if (this.deferred && this.a.catalog.some((t) => t.function.name === call.name)) this.loaded.add(call.name);
    return undefined;
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
      ...(this.deferred ? { loadedTools: [...this.loaded] } : {}),
      ...(this.taskState ? { taskState: this.taskState } : {}),
      ...(this.budgetOn && this.spend && !this.child ? { ...this.spend } : {}),
      ...(this.budgetOn ? { tokenCap: this.tokenCap } : {}),
    };
  }

  /** C1 telemetry: the advertised set and what its schemas cost, whenever it changes. */
  private async recordToolsChange(step: number): Promise<void> {
    if (!this.deferred) return;
    const tools = this.tools();
    const signature = tools.map((t) => t.function.name).join(',');
    if (signature === this.toolsSignature) return;
    this.toolsSignature = signature;
    const toolsTokens = toolsTokensOf(tools);
    await this.a.record('context.tools', 'context', {
      step, advertised: tools.length, catalog: this.a.catalog.length, toolsTokens, loaded: [...this.loaded],
    }, `${tools.length}/${this.a.catalog.length} tools advertised (~${toolsTokens} tokens of schemas)`);
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

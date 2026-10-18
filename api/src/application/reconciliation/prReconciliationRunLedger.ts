/**
 * The persistence of ONE PR/ticket reconciliation run — its run row, item rows and
 * handled errors — buffered in memory and written once, at the end, only when the
 * run is worth recording.
 *
 * WHY BUFFERED. The run used to INSERT its run row first (as the lease and the cadence
 * marker), then one item row per open PR, then UPDATE the run when it finished. The
 * scheduled reconciler does that per repo every 30 minutes, so a repo whose PRs had not
 * moved still wrote a run row + N item rows + an UPDATE each time — Postgres writes on a
 * timer that kept the Neon compute awake and grew the tables by millions of rows of
 * "nothing changed". The cadence now lives in KV (runPrReconciliationSweep), so the run
 * row no longer has a job to do on an idle run, and {@link finish} skips it entirely.
 *
 * The run id is minted up front so everything that cites the run (the manager journal's
 * `detail.runId`, error reports) can do so before the row exists; a journal entry is
 * itself a change, so a run cited that way is always persisted.
 */
import type { Db } from '../../infrastructure/database/connection';
import { prReconciliationErrors, prReconciliationItems, prReconciliationRuns } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ReconciliationError } from './reconciliationError';

const SOURCE = 'application/reconciliation/prReconciliationRunLedger.ts';
const ITEM_BATCH = 100;

export type ReconciliationRunStatus = 'completed' | 'completed_with_errors' | 'failed';
/** `always` — an operator-requested run (its id is the handle for diagnostics).
 *  `on_change` — the scheduled sweep: an idle run writes nothing. */
export type ReconciliationPersistence = 'always' | 'on_change';

export interface ReconciliationErrorContext {
  prNumber?: number;
  phase: 'configuration' | 'collection' | 'correlation' | 'classification' | 'action' | 'persistence';
  code?: string;
  details?: Record<string, unknown>;
}

type ItemRow = typeof prReconciliationItems.$inferInsert;
type ErrorRow = typeof prReconciliationErrors.$inferInsert;

export interface RunLedgerBase {
  tenantId: number;
  projectId: number;
  repoId: string;
  agentRef: string | null;
  mode: 'dry_run' | 'apply';
  requestedBy: string | null;
  approvedPrNumbers: number[];
}

export class ReconciliationRunLedger {
  readonly runId: string = crypto.randomUUID();
  private readonly startedAt = new Date();
  private readonly items: ItemRow[] = [];
  private readonly errors: ErrorRow[] = [];

  constructor(
    private readonly db: Db,
    private readonly base: RunLedgerBase,
    private readonly persistence: ReconciliationPersistence,
  ) {}

  get errorCount(): number {
    return this.errors.length;
  }

  /** Report (unless told not to) and buffer one handled error for the run's diagnostics. */
  recordError(context: ReconciliationErrorContext, error: unknown, opts: { report?: boolean } = {}): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const code = error instanceof ReconciliationError ? error.code : (context.code ?? 'UNEXPECTED_ERROR');
    const details = { ...context.details, ...(error instanceof ReconciliationError ? error.details : {}) };
    if (opts.report !== false) reportCaughtError(error, {
      source: 'application/reconciliation/prReconciliationService.ts',
      operation: `prReconciliation.${context.phase}`,
      context: { runId: this.runId, repoId: this.base.repoId, prNumber: context.prNumber, code, details },
    });
    this.errors.push({
      runId: this.runId, tenantId: this.base.tenantId, repoId: this.base.repoId,
      prNumber: context.prNumber, phase: context.phase, code,
      message: normalized.message, stack: normalized.stack ?? null, details,
    });
  }

  /** Buffer the run's item rows (one per PR seen). */
  addItems(rows: ItemRow[]): void {
    this.items.push(...rows);
  }

  /** Mark a buffered item as closed by the run. */
  markClosed(prNumber: number, at: Date = new Date()): void {
    for (const item of this.items) {
      if (item.prNumber === prNumber) {
        item.appliedAction = 'close';
        item.appliedAt = at;
      }
    }
  }

  /**
   * Write the run (row, items, errors) — or nothing at all when this is an `on_change`
   * run that changed nothing and hit no error. Returns whether the run was persisted.
   */
  async finish(args: {
    status: ReconciliationRunStatus;
    summary?: Record<string, number>;
    approvedPrNumbers?: number[];
    changed: boolean;
  }): Promise<boolean> {
    if (this.persistence === 'on_change' && !args.changed && this.errors.length === 0) return false;
    await this.db.insert(prReconciliationRuns).values({
      id: this.runId,
      ...this.base,
      approvedPrNumbers: args.approvedPrNumbers ?? this.base.approvedPrNumbers,
      status: args.status,
      summary: args.summary ?? {},
      errorCount: this.errors.length,
      startedAt: this.startedAt,
      finishedAt: new Date(),
    });
    for (let offset = 0; offset < this.items.length; offset += ITEM_BATCH) {
      await this.db.insert(prReconciliationItems).values(this.items.slice(offset, offset + ITEM_BATCH));
    }
    if (this.errors.length) {
      try {
        await this.db.insert(prReconciliationErrors).values(this.errors);
      } catch (persistenceError) {
        reportCaughtError(persistenceError, {
          source: SOURCE,
          operation: 'prReconciliation.persistError',
          context: { runId: this.runId, errorCount: this.errors.length, firstCode: this.errors[0]?.code },
        });
      }
    }
    return true;
  }
}

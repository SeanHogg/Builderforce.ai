/**
 * A BOARD'S EARNED BUDGET.
 *
 * A board EARNS budget when its tickets reach Done: one `grant` of `points` on the
 * board's ledger account per ticket, keyed `board-earn:<taskId>` so a reopened and
 * re-closed ticket pays once. The amount is the ticket's story points, 1 when
 * unestimated. It SPENDS when runs on its tickets cost money — but that cost is
 * already a fact (`llm_usage_log.cost_usd_millicents`, attributed to the project),
 * so spend is a read-model ROLLUP over it, never a second ledger row that could
 * drift from the first.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { boards, llmUsageLog, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { resolveUsageDatabase } from '../llm/usageLedger';
import { accountLedger, type AccountStatementRow } from '../kernel/accountLedger';
import { POINTS } from '../kernel/denominations';
import { boardAccount } from '../kernel/ledgerAccount';
import { BOARD_EARN_PREFIX, boardBudgetCacheKey } from './boardBudgetKeys';
import { listBoardMilestonesSince, type BoardMilestone } from './boardMilestones';

const boardLedger = accountLedger(POINTS, 'board-points');

/** Cost is stored in millicents (1/100000 USD); a cent is 1000 of them. */
const MILLICENTS_PER_CENT = 1000;
const MILESTONE_LOOKBACK_DAYS = 365;

/**
 * Credit the board a closed ticket belongs to. Called from `recordStatusTransition`
 * (the one path every lane move funnels through). Epics earn nothing themselves —
 * their children already did, and counting both would pay the same work twice.
 * Returns false when nothing was credited (no board, an epic, or already paid).
 */
export async function earnBoardBudget(
  db: Db, env: Env, input: { tenantId: number; taskId: number },
): Promise<boolean> {
  const [row] = await db
    .select({ boardId: boards.id, points: tasks.storyPoints, taskType: tasks.taskType, title: tasks.title })
    .from(tasks)
    .innerJoin(boards, and(eq(boards.projectId, tasks.projectId), eq(boards.tenantId, tasks.tenantId)))
    .where(scopedToTenant(tasks, input.tenantId, eq(tasks.id, input.taskId)))
    .limit(1);
  if (!row || row.taskType === 'epic') return false;

  const credited = await boardLedger.credit(db, env, boardAccount(row.boardId), {
    tenantId: input.tenantId,
    amount: row.points != null && row.points > 0 ? row.points : 1,
    reference: `${BOARD_EARN_PREFIX}${input.taskId}`,
    memo: row.title,
    metadata: { taskId: input.taskId },
  });
  if (credited) await invalidateCached(env, boardBudgetCacheKey(input.tenantId, row.boardId));
  return credited;
}

export interface BoardBudget {
  /** Points earned by Done tickets. */
  balance: number;
  /** Run cost on the board's project, in USD cents (a rollup, not a ledger row). */
  spentUsdCents: number;
  statement: AccountStatementRow[];
  milestones: BoardMilestone[];
}

/** The board's budget view, or null when the board is not in the tenant. */
export async function readBoardBudget(
  db: Db, env: Env, tenantId: number, boardId: string,
): Promise<BoardBudget | null> {
  const [board] = await db
    .select({ projectId: boards.projectId })
    .from(boards)
    .where(scopedToTenant(boards, tenantId, eq(boards.id, boardId)))
    .limit(1);
  if (!board) return null;

  return getOrSetCached(env, boardBudgetCacheKey(tenantId, boardId), async () => {
    const account = boardAccount(boardId);
    const since = new Date(Date.now() - MILESTONE_LOOKBACK_DAYS * 86_400_000);
    const [balance, statement, milestones, spentUsdCents] = await Promise.all([
      boardLedger.balance(db, env, tenantId, account),
      boardLedger.statement(db, tenantId, account, 20),
      listBoardMilestonesSince(db, { tenantId, since, boardId, limit: 20 }),
      projectSpendUsdCents(env, db, tenantId, board.projectId),
    ]);
    return { balance, spentUsdCents, statement, milestones };
  }, { kvTtlSeconds: 60 });
}

async function projectSpendUsdCents(env: Env, db: Db, tenantId: number, projectId: number): Promise<number> {
  const usage = resolveUsageDatabase(env, db);
  const [row] = await usage
    .select({ total: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)` })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.projectId, projectId)));
  return Math.round(Number(row?.total ?? 0) / MILLICENTS_PER_CENT);
}

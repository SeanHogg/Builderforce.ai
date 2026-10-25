/**
 * SPENT vs SAVED — the one reader behind the chat's spend pill and the `/` menu's Status
 * tab. It reads ONE relation, `llm_usage_log`, which holds both halves: what was spent,
 * and (1227) what memory saved on — or instead of — each call.
 *
 * No endpoint of its own. The figures ride responses the surfaces already fetch: each
 * chat carries its own (`attachChatSpend`, beside its ticket health), and the workspace
 * figure rides the consumption snapshot the Status tab already reads.
 *
 * How spent and saved are split (platform vs your key, measured vs estimated) is the
 * shared fold's rule — see `@builderforce/spend-contract` `fold.ts`.
 */

import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { EMPTY_PRICE_BOOK, loadPriceBook, type PriceBook } from './catalogView';
import { usageDatabaseOf, usageRequestCount } from './usageLedger';
import { foldSpendSavings, type SpendSavingsSummary, type UsageSlice } from '@builderforce/spend-contract';

// The wire contract AND its fold are declared once, in `@builderforce/spend-contract`:
// the VS Code device folds its own run usage with the same function (PRD 36). This
// module only reads the ledger into slices.
export { foldSpendSavings, type UsageSlice } from '@builderforce/spend-contract';
export type {
  SavingsBreakdown,
  SavingsBySource,
  SavingsSourceKey,
  SpendBreakdown,
  SpendSavingsSummary,
} from '@builderforce/spend-contract';

const sliceColumns = {
  model: llmUsageLog.model,
  byo: llmUsageLog.byo,
  savingsSource: llmUsageLog.savingsSource,
  savingsEstimated: llmUsageLog.savingsEstimated,
  prompt: sql<string>`coalesce(sum(${llmUsageLog.promptTokens}), 0)::bigint`,
  completion: sql<string>`coalesce(sum(${llmUsageLog.completionTokens}), 0)::bigint`,
  cacheRead: sql<string>`coalesce(sum(${llmUsageLog.cacheReadTokens}), 0)::bigint`,
  cacheCreation: sql<string>`coalesce(sum(${llmUsageLog.cacheCreationTokens}), 0)::bigint`,
  total: sql<string>`coalesce(sum(${llmUsageLog.totalTokens}), 0)::bigint`,
  costMc: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)::bigint`,
  calls: usageRequestCount(),
  cacheCalls: sql<number>`coalesce(sum(case when ${llmUsageLog.cacheReadTokens} > 0 then ${llmUsageLog.calls} else 0 end), 0)::int`,
  savedPrompt: sql<string>`coalesce(sum(${llmUsageLog.savedPromptTokens}), 0)::bigint`,
  savedCompletion: sql<string>`coalesce(sum(${llmUsageLog.savedCompletionTokens}), 0)::bigint`,
  recallPrompt: sql<string>`coalesce(sum(${llmUsageLog.recallPromptTokens}), 0)::bigint`,
  savedCostMc: sql<string>`coalesce(sum(${llmUsageLog.savedCostUsdMillicents}), 0)::bigint`,
  trimCalls: sql<number>`coalesce(sum(case when ${llmUsageLog.savedPromptTokens} > 0 and ${llmUsageLog.savingsSource} is null then ${llmUsageLog.calls} else 0 end), 0)::int`,
  recallCalls: sql<number>`coalesce(sum(case when ${llmUsageLog.recallPromptTokens} > 0 then ${llmUsageLog.calls} else 0 end), 0)::int`,
  // usage-count-ok: avoided-call rows have calls = 0 by definition, so an avoided call is
  // counted by its ROW — and the fold keeps one row per (source, day), which is the grain
  // the Status tab reports avoided answers at.
  rows: sql<number>`count(*)::int`,
};

type SliceRow = { [K in keyof typeof sliceColumns]: unknown };

function toSlice(r: SliceRow): UsageSlice {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    model: String(r.model),
    byo: r.byo === true,
    savingsSource: (r.savingsSource as string | null) ?? null,
    savingsEstimated: r.savingsEstimated === true,
    prompt: n(r.prompt), completion: n(r.completion), cacheRead: n(r.cacheRead), cacheCreation: n(r.cacheCreation),
    total: n(r.total), costMc: n(r.costMc), calls: n(r.calls), cacheCalls: n(r.cacheCalls),
    savedPrompt: n(r.savedPrompt), savedCompletion: n(r.savedCompletion), recallPrompt: n(r.recallPrompt),
    savedCostMc: n(r.savedCostMc), trimCalls: n(r.trimCalls), recallCalls: n(r.recallCalls), rows: n(r.rows),
  };
}

/** FNV-1a over the sorted id set — a stable, short cache-key component. */
function idSetHash(ids: readonly number[]): string {
  let h = 0x811c9dc5;
  const text = ids.join(',');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const priceBookFor = (env: Env | undefined): Promise<PriceBook> => (env ? loadPriceBook(env) : Promise.resolve(EMPTY_PRICE_BOOK));

/**
 * Spend and savings for a SET of chats — one grouped query for the whole list, so the
 * chat list and a single chat read cost the same one scan (never one per chat).
 * Cached by the sorted id set for a short window: a turn's usage rows land just after
 * it settles, and the surfaces re-read the chat then anyway.
 */
export async function chatsSpendSavings(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  chatIds: readonly number[],
): Promise<Map<number, SpendSavingsSummary>> {
  const ids = [...new Set(chatIds.filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
  if (ids.length === 0) return new Map();
  const entries = await getOrSetCached(
    env,
    // Hashed: a long chat list would overrun the KV key limit.
    `spend-savings:chats:v1:${tenantId}:${ids.length}:${idSetHash(ids)}`,
    async () => {
      const [rows, book] = await Promise.all([
        usageDatabaseOf(db)
          .select({ chatId: llmUsageLog.chatId, ...sliceColumns })
          .from(llmUsageLog)
          .where(and(eq(llmUsageLog.tenantId, tenantId), inArray(llmUsageLog.chatId, ids)) as SQL)
          .groupBy(llmUsageLog.chatId, llmUsageLog.model, llmUsageLog.byo, llmUsageLog.savingsSource, llmUsageLog.savingsEstimated),
        priceBookFor(env),
      ]);
      const byChat = new Map<number, UsageSlice[]>();
      for (const r of rows) {
        const id = Number(r.chatId);
        const list = byChat.get(id) ?? [];
        list.push(toSlice(r));
        byChat.set(id, list);
      }
      return [...byChat].map(([id, slices]) => [id, foldSpendSavings(slices, book)] as const);
    },
    { kvTtlSeconds: 30, l1TtlMs: 10_000 },
  );
  return new Map(entries);
}

/** Days the period grain accepts. */
export const SPEND_PERIOD_DAYS = 30;

/** The workspace's spend and savings over the last {@link SPEND_PERIOD_DAYS} days. */
export function periodSpendSavings(env: Env | undefined, db: Db, tenantId: number): Promise<SpendSavingsSummary> {
  // Bucketed to the hour so every member's read in that hour shares one scan.
  const hour = Math.floor(Date.now() / 3_600_000);
  return getOrSetCached(
    env,
    `spend-savings:period:v1:${tenantId}:${SPEND_PERIOD_DAYS}:${hour}`,
    async () => {
      const since = new Date((hour + 1) * 3_600_000 - SPEND_PERIOD_DAYS * 86_400_000);
      const [rows, book] = await Promise.all([
        usageDatabaseOf(db)
          .select(sliceColumns)
          .from(llmUsageLog)
          .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, since)) as SQL)
          .groupBy(llmUsageLog.model, llmUsageLog.byo, llmUsageLog.savingsSource, llmUsageLog.savingsEstimated),
        priceBookFor(env),
      ]);
      return foldSpendSavings(rows.map(toSlice), book);
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/**
 * SPENT vs SAVED — the one reader behind the chat's spend pill and the `/` menu's Status
 * tab. It reads ONE relation, `llm_usage_log`, which holds both halves: what was spent,
 * and (1227) what memory saved on — or instead of — each call.
 *
 * No endpoint of its own. The figures ride responses the surfaces already fetch: each
 * chat carries its own (`attachChatSpend`, beside its ticket health), and the workspace
 * figure rides the consumption snapshot the Status tab already reads.
 *
 * SPENT, split the way the person actually pays:
 *   platform — `cost_usd_millicents` as stamped (what the plan / overflow billed);
 *   your key — BYO rows priced at LIST (the ledger records 0 because the platform paid
 *              nothing, but the person's own key did).
 *   A model the catalog does not price contributes tokens and no dollars, counted in
 *   `unpricedTokens` rather than silently valued at zero.
 *
 * SAVED, kept apart by certainty:
 *   measured  — avoided calls whose figures were recorded (a cached answer's stored
 *               production cost, a gateway replay's stored usage) PLUS the provider's
 *               own prompt cache, from the cache tokens the provider reported;
 *   estimated — character estimates: Evermind answers, compaction, minus the tokens
 *               recall added to prompts.
 */

import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { millicentsToUsd } from '../../domain/shared/money';
import { EMPTY_PRICE_BOOK, loadPriceBook, type PriceBook } from './catalogView';
import {
  CACHE_CREATION_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
  computeCostMillicents,
  usageDatabaseOf,
  usageRequestCount,
} from './usageLedger';
import type {
  SavingsBreakdown,
  SavingsBySource,
  SavingsSourceKey,
  SpendBreakdown,
  SpendSavingsSummary,
} from '@builderforce/spend-contract';

// The wire contract is declared once, in `@builderforce/spend-contract`, and read by
// every client surface; this module only produces it.
export type {
  SavingsBreakdown,
  SavingsBySource,
  SavingsSourceKey,
  SpendBreakdown,
  SpendSavingsSummary,
} from '@builderforce/spend-contract';

/** One grouped slice of the ledger — the unit both grains fold. */
export interface UsageSlice {
  model: string;
  byo: boolean;
  savingsSource: string | null;
  savingsEstimated: boolean;
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
  costMc: number;
  calls: number;
  cacheCalls: number;
  savedPrompt: number;
  savedCompletion: number;
  recallPrompt: number;
  savedCostMc: number;
  trimCalls: number;
  recallCalls: number;
  rows: number;
}

const AVOIDED_SOURCES = new Set(['memory_answer', 'evermind_answer', 'response_cache']);

/** Fold ledger slices into the summary. Pure — the pricing rules are unit-testable. */
export function foldSpendSavings(slices: readonly UsageSlice[], book: PriceBook): SpendSavingsSummary {
  const spend: SpendBreakdown = {
    platformUsd: 0, yourKeyUsd: 0, totalUsd: 0,
    promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, totalTokens: 0, unpricedTokens: 0, requests: 0,
  };
  let platformMc = 0;
  let yourKeyMc = 0;
  // Keyed by source AND certainty: one source can hold both (an answer cached with its
  // production cost is measured, one cached before costs were recorded is estimated),
  // and folding them together would relabel measured dollars as estimates.
  const acc = new Map<string, { source: SavingsSourceKey; mc: number; tokens: number; events: number; estimated: boolean }>();
  const add = (source: SavingsSourceKey, mc: number, tokens: number, events: number, estimated: boolean) => {
    if (tokens === 0 && mc === 0) return;
    const key = `${source}:${estimated ? 'e' : 'm'}`;
    const prev = acc.get(key) ?? { source, mc: 0, tokens: 0, events: 0, estimated };
    acc.set(key, { ...prev, mc: prev.mc + mc, tokens: prev.tokens + tokens, events: prev.events + events });
  };

  for (const g of slices) {
    const price = book.priceOf(g.model);
    const pricing = price ? { prompt: price.input, completion: price.output } : undefined;
    // An AVOIDED call: nothing spent, the whole call saved (value stamped at write).
    if (g.savingsSource && AVOIDED_SOURCES.has(g.savingsSource)) {
      add(g.savingsSource as SavingsSourceKey, g.savedCostMc, g.savedPrompt + g.savedCompletion, g.rows, g.savingsEstimated);
      continue;
    }
    spend.promptTokens += g.prompt;
    spend.completionTokens += g.completion;
    spend.cacheReadTokens += g.cacheRead;
    spend.totalTokens += g.total;
    spend.requests += g.calls;
    platformMc += g.costMc;
    if (!pricing) spend.unpricedTokens += g.total;
    else if (g.byo) {
      yourKeyMc += computeCostMillicents(pricing, {
        promptTokens: g.prompt, completionTokens: g.completion, totalTokens: g.total,
        cacheReadTokens: g.cacheRead, cacheCreationTokens: g.cacheCreation,
      });
    }
    // Compaction and recall on real calls — split by the same price the writer used.
    if (pricing) {
      add('context_trim', Math.round(g.savedPrompt * pricing.prompt * 100_000), g.savedPrompt, g.trimCalls, true);
      add('recall_overhead', -Math.round(g.recallPrompt * pricing.prompt * 100_000), -g.recallPrompt, g.recallCalls, true);
      // The provider's own prompt cache: a cache READ costs 0.1× input (saves 0.9×); a
      // cache WRITE costs 1.25× (gives back 0.25×).
      const net = (g.cacheRead * (1 - CACHE_READ_MULTIPLIER) - g.cacheCreation * (CACHE_CREATION_MULTIPLIER - 1)) * pricing.prompt;
      add('prompt_cache', Math.round(net * 100_000), g.cacheRead, g.cacheCalls, false);
    } else {
      add('context_trim', 0, g.savedPrompt, g.trimCalls, true);
      add('recall_overhead', 0, -g.recallPrompt, g.recallCalls, true);
    }
  }

  spend.platformUsd = millicentsToUsd(platformMc);
  spend.yourKeyUsd = millicentsToUsd(yourKeyMc);
  spend.totalUsd = millicentsToUsd(platformMc + yourKeyMc);

  let measuredMc = 0;
  let estimatedMc = 0;
  let tokensSaved = 0;
  const bySource: SavingsBySource[] = [];
  for (const v of acc.values()) {
    if (v.estimated) estimatedMc += v.mc;
    else measuredMc += v.mc;
    tokensSaved += v.tokens;
    bySource.push({ source: v.source, usd: millicentsToUsd(v.mc), tokens: v.tokens, events: v.events, estimated: v.estimated });
  }
  bySource.sort((a, b) => b.usd - a.usd);
  const saved: SavingsBreakdown = {
    measuredUsd: millicentsToUsd(measuredMc),
    estimatedUsd: millicentsToUsd(estimatedMc),
    netUsd: millicentsToUsd(measuredMc + estimatedMc),
    tokensSaved: Math.max(0, tokensSaved),
    bySource,
  };
  const denom = spend.totalUsd + Math.max(0, saved.netUsd);
  return { spend, saved, savedPct: denom > 0 ? Math.max(0, saved.netUsd) / denom : null };
}

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

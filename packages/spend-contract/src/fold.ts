/**
 * THE fold from usage slices to SPENT vs SAVED — one pure function, run by the api over
 * `llm_usage_log` (`spendSavingsSummary.ts`) and by a device over its own run usage
 * ledger (PRD 36), so the chat's spend pill means the same thing wherever it was priced.
 * The fold never knows where its prices came from: the gateway hands it the live
 * catalog's book, a device the release's bundled snapshot (`snapshotPriceBook`).
 *
 * SPENT, split the way the person actually pays:
 *   platform — the slice's recorded cost (`costMc`: what the plan / overflow billed);
 *   your key — BYO slices priced at LIST (the platform paid nothing, the person's key did).
 *   A model the book does not price contributes tokens and no dollars, counted in
 *   `unpricedTokens` rather than silently valued at zero.
 *
 * SAVED, kept apart by certainty:
 *   measured  — avoided calls whose figures were recorded, plus the provider's own prompt
 *               cache, from the cache tokens the provider reported;
 *   estimated — character estimates (Evermind answers, compaction, minus what recall
 *               added) and a local model's counterfactual (`local_model`).
 */

import { listPriceOf, type PriceBook } from '@builderforce/model-catalog';
import { CACHE_CREATION_MULTIPLIER, CACHE_READ_MULTIPLIER, computeCostMillicents, millicentsToUsd } from './cost.js';
import type { SavingsBreakdown, SavingsBySource, SavingsSourceKey, SpendBreakdown, SpendSavingsSummary } from './index.js';

/** One grouped slice of usage — the unit both grains (and both hosts) fold. */
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
  /** The producer could not price this call (off the device, no price known): counted as `unpricedTokens`, never
   *  valued. Absent = derive it from the book, as the platform ledger's slices do. */
  unpriced?: boolean;
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

const AVOIDED_SOURCES = new Set(['memory_answer', 'evermind_answer', 'response_cache', 'deterministic']);

/** A call a model on the person's own machine served: real tokens, nothing billed, and
 *  the paid route's price for the same tokens (stamped by the producer) saved. */
const LOCAL_MODEL_SOURCE = 'local_model';

type SourceAccumulator = Map<string, { source: SavingsSourceKey; mc: number; tokens: number; events: number; estimated: boolean }>;

function addSaving(acc: SourceAccumulator, source: SavingsSourceKey, mc: number, tokens: number, events: number, estimated: boolean): void {
  if (tokens === 0 && mc === 0) return;
  // Keyed by source AND certainty: one source can hold both (an answer cached with its
  // production cost is measured, one cached before costs were recorded is estimated),
  // and folding them together would relabel measured dollars as estimates.
  const key = `${source}:${estimated ? 'e' : 'm'}`;
  const prev = acc.get(key) ?? { source, mc: 0, tokens: 0, events: 0, estimated };
  acc.set(key, { ...prev, mc: prev.mc + mc, tokens: prev.tokens + tokens, events: prev.events + events });
}

/** The saved half from its per-source accumulator, and the saved share of the bill. */
function savedFrom(acc: SourceAccumulator, spentUsd: number): { saved: SavingsBreakdown; savedPct: number | null } {
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
  const denom = spentUsd + Math.max(0, saved.netUsd);
  return { saved, savedPct: denom > 0 ? Math.max(0, saved.netUsd) / denom : null };
}

/** Fold usage slices into the summary. Pure — the pricing rules are unit-testable. */
export function foldSpendSavings(slices: readonly UsageSlice[], book: PriceBook): SpendSavingsSummary {
  const spend: SpendBreakdown = {
    platformUsd: 0, yourKeyUsd: 0, totalUsd: 0,
    promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, totalTokens: 0, unpricedTokens: 0, requests: 0,
  };
  let platformMc = 0;
  let yourKeyMc = 0;
  const acc: SourceAccumulator = new Map();

  for (const g of slices) {
    // An AVOIDED call: nothing spent, the whole call saved (value stamped at write).
    if (g.savingsSource && AVOIDED_SOURCES.has(g.savingsSource)) {
      addSaving(acc, g.savingsSource as SavingsSourceKey, g.savedCostMc, g.savedPrompt + g.savedCompletion, g.rows, g.savingsEstimated);
      continue;
    }
    spend.promptTokens += g.prompt;
    spend.completionTokens += g.completion;
    spend.cacheReadTokens += g.cacheRead;
    spend.totalTokens += g.total;
    spend.requests += g.calls;
    // A LOCAL model's call: real tokens, $0, and its counterfactual (stamped at write —
    // the local model has no price of its own) saved. Never "unpriced": it cost nothing.
    if (g.savingsSource === LOCAL_MODEL_SOURCE) {
      addSaving(acc, LOCAL_MODEL_SOURCE, g.savedCostMc, g.savedPrompt + g.savedCompletion, g.calls, true);
      continue;
    }
    platformMc += g.costMc;
    // List price: a BYO direct-vendor call (`direct/minimax/…`) is valued at the catalog's
    // price for that model, not left unpriced at $0.
    const price = listPriceOf(book, g.model);
    const pricing = price ? { prompt: price.input, completion: price.output } : undefined;
    const unpriced = g.unpriced ?? !pricing;
    if (unpriced) spend.unpricedTokens += g.total;
    else if (g.byo && pricing) {
      yourKeyMc += computeCostMillicents(pricing, {
        promptTokens: g.prompt, completionTokens: g.completion, totalTokens: g.total,
        cacheReadTokens: g.cacheRead, cacheCreationTokens: g.cacheCreation,
      });
    }
    // Compaction and recall on real calls — split by the same price the writer used.
    if (pricing && !unpriced) {
      addSaving(acc, 'context_trim', Math.round(g.savedPrompt * pricing.prompt * 100_000), g.savedPrompt, g.trimCalls, true);
      addSaving(acc, 'recall_overhead', -Math.round(g.recallPrompt * pricing.prompt * 100_000), -g.recallPrompt, g.recallCalls, true);
      // The provider's own prompt cache: a cache READ costs 0.1× input (saves 0.9×); a
      // cache WRITE costs 1.25× (gives back 0.25×).
      const net = (g.cacheRead * (1 - CACHE_READ_MULTIPLIER) - g.cacheCreation * (CACHE_CREATION_MULTIPLIER - 1)) * pricing.prompt;
      addSaving(acc, 'prompt_cache', Math.round(net * 100_000), g.cacheRead, g.cacheCalls, false);
    } else {
      addSaving(acc, 'context_trim', 0, g.savedPrompt, g.trimCalls, true);
      addSaving(acc, 'recall_overhead', 0, -g.recallPrompt, g.recallCalls, true);
    }
  }

  spend.platformUsd = millicentsToUsd(platformMc);
  spend.yourKeyUsd = millicentsToUsd(yourKeyMc);
  spend.totalUsd = millicentsToUsd(platformMc + yourKeyMc);
  return { spend, ...savedFrom(acc, spend.totalUsd) };
}

/**
 * Two summaries of DISJOINT usage as one — the bound VS Code chat's pill: the platform's
 * figure for the calls it served, plus the device's figure for the calls it never saw.
 * The spend is an estimate when either half is. Pure.
 */
export function combineSpendSavings(a: SpendSavingsSummary, b: SpendSavingsSummary): SpendSavingsSummary {
  const sum = (k: Exclude<keyof SpendBreakdown, 'estimated'>) => a.spend[k] + b.spend[k];
  const spend: SpendBreakdown = {
    platformUsd: sum('platformUsd'), yourKeyUsd: sum('yourKeyUsd'), totalUsd: sum('totalUsd'),
    promptTokens: sum('promptTokens'), completionTokens: sum('completionTokens'), cacheReadTokens: sum('cacheReadTokens'),
    totalTokens: sum('totalTokens'), unpricedTokens: sum('unpricedTokens'), requests: sum('requests'),
    ...(a.spend.estimated || b.spend.estimated ? { estimated: true } : {}),
  };
  const acc: SourceAccumulator = new Map();
  for (const row of [...a.saved.bySource, ...b.saved.bySource]) {
    addSaving(acc, row.source, Math.round(row.usd * 100_000), row.tokens, row.events, row.estimated);
  }
  return { spend, ...savedFrom(acc, spend.totalUsd) };
}

/**
 * A local chat's SPEND, read from its run usage ledger rows (`usageLedger.ts`, PRD 36
 * §3.2). A row is priced only here, when read, by the ONE fold
 * (`@builderforce/spend-contract`) over the release's bundled price snapshot, so the
 * device and the api's ledger run the same arithmetic.
 */

import type { EntityDestination, LocalFirstTransaction } from '@builderforce/local-first';
import { pricedId } from '@builderforce/local-inference';
import { snapshotPriceBook, type PriceBook } from '@builderforce/model-catalog';
import { foldSpendSavings, type SpendSavingsSummary, type UsageSlice } from '@builderforce/spend-contract';
import { isImported } from './journal';
import { liveRecords } from './records';
import { callCostOrUnknown, isOwnKeySpend } from './callCost';
import type { RunUsageValue } from './usageLedger';

/**
 * One ledger row as a fold slice, priced by the device's ONE call-cost rule
 * (`callCost.ts`, keyed by the row's route). A gateway call's cost is platform spend (an
 * estimate). A BYO call is the person's own money and IS counted — but as "your key":
 * the fold values `byo` slices at the same list price into `yourKeyUsd`, so the slice's
 * platform cost stays 0 and the call is never counted twice.
 */
function sliceOf(row: RunUsageValue, book: PriceBook): UsageSlice {
  const total = row.promptTokens + row.completionTokens;
  const local = row.savingsSource === 'local_model';
  const avoided = row.savingsSource === 'deterministic';
  const ownKey = isOwnKeySpend(row.route);
  // THE unpriced decision, made once by the device cost rule and carried on the slice: an unpriced call adds no
  // platform cost (the number is only filled with 0) and the fold counts its tokens as `unpricedTokens` from the
  // flag — it does not look the price up again. A BYO call is valued in the fold, so only its price can be absent.
  const cost = callCostOrUnknown(row.model, {
    prompt: row.promptTokens,
    completion: row.completionTokens,
    cacheRead: row.cacheReadTokens,
    cacheCreation: row.cacheCreationTokens,
  }, book, row.route);
  const unpriced = !(local || avoided) && cost === undefined;
  const costMc = local || avoided || ownKey ? 0 : (cost ?? 0);
  return {
    // The model is the id the call is PRICED under (a hosted runtime's registry alias), for the fold's valuation.
    model: pricedId(row.model),
    unpriced,
    byo: ownKey,
    savingsSource: row.savingsSource ?? null,
    // Both are estimates: a local call's counterfactual, an avoided call's median turn.
    savingsEstimated: local || avoided,
    prompt: row.promptTokens,
    completion: row.completionTokens,
    cacheRead: row.cacheReadTokens,
    cacheCreation: row.cacheCreationTokens,
    total,
    costMc,
    calls: avoided ? 0 : 1,
    cacheCalls: row.cacheReadTokens > 0 ? 1 : 0,
    savedPrompt: row.savedPrompt ?? 0,
    savedCompletion: row.savedCompletion ?? 0,
    recallPrompt: row.recallPrompt ?? 0,
    savedCostMc: row.savedCostMc ?? 0,
    trimCalls: 0,
    recallCalls: 0,
    rows: 1,
  };
}

/**
 * A local chat's spend from its ledger rows (§3.2). `excludeGateway` = the platform's
 * figure for this chat is being added, so the rows it already accounts for are left
 * out and counted once, not twice: its gateway calls, and the calls a sync import
 * put on the platform (`imported`, by `clientEventId`). A figure that priced any
 * gateway call on the device is an estimate.
 */
export function ledgerSpend(
  rows: readonly RunUsageValue[],
  opts: { excludeGateway: boolean; imported?: ReadonlySet<string>; book?: PriceBook },
): SpendSavingsSummary | null {
  const book = opts.book ?? snapshotPriceBook();
  const kept = opts.excludeGateway
    ? rows.filter((row) => row.route !== 'gateway' && !opts.imported?.has(row.clientEventId))
    : rows;
  if (kept.length === 0) return null;
  const summary = foldSpendSavings(kept.map((row) => sliceOf(row, book)), book);
  return kept.some((row) => row.route === 'gateway') ? { ...summary, spend: { ...summary.spend, estimated: true } } : summary;
}

/** Of a chat's ledger rows, the ones a sync receipt says the platform imported. */
export async function importedUsageIds(
  tx: LocalFirstTransaction,
  rows: readonly RunUsageValue[],
  destination: EntityDestination,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.route !== 'gateway' && isImported(await tx.mapping('usage', row.clientEventId, destination))) ids.add(row.clientEventId);
  }
  return ids;
}

/** Every chat's ledger rows, by chat client id — one read for a whole chat list. */
export async function usageRowsByChat(tx: LocalFirstTransaction, deviceId: string): Promise<Map<string, RunUsageValue[]>> {
  const byChat = new Map<string, RunUsageValue[]>();
  for (const row of await liveRecords<RunUsageValue>(tx, 'usage', deviceId)) {
    const list = byChat.get(row.payload.clientChatId) ?? [];
    list.push(row.payload);
    byChat.set(row.payload.clientChatId, list);
  }
  return byChat;
}

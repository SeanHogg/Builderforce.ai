/**
 * The PAID ROUTE a chat's savings are valued against (PRD 36 §36.3) — what the chat's
 * paid route would have charged for the same tokens. A local call's counterfactual
 * (`usageLedger.ts`) and an avoided call's saving (`gateLedger.ts`) both price by it.
 */

import type { LocalFirstTransaction } from '@builderforce/local-first';
import { ANTHROPIC_RELEASES, listPriceOf, type PriceBook } from '@builderforce/model-catalog';
import { liveRecords } from './records';
import type { RunUsageValue } from './usageLedger';

/** The paid route a local call is valued against when the chat never used one: the
 *  platform's default coder (the current Sonnet), by its catalog id. */
const DEFAULT_PAID_ROUTE = `anthropic/claude-sonnet-${ANTHROPIC_RELEASES.sonnet[0]}`;

/** A token count as the ledger stores it: a finite, positive integer, else 0. */
export const ledgerCount = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** What the chat's paid route charges per token: its latest priced gateway call's model, else the default. */
export function paidRouteOf(rows: readonly RunUsageValue[], book: PriceBook): { prompt: number; completion: number } | undefined {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.route === 'local') continue;
    const price = listPriceOf(book, row.model);
    if (price) return { prompt: price.input, completion: price.output };
  }
  const fallback = listPriceOf(book, DEFAULT_PAID_ROUTE);
  return fallback ? { prompt: fallback.input, completion: fallback.output } : undefined;
}

/** A chat's usage rows, oldest first. */
export async function usageRowsOf(tx: LocalFirstTransaction, deviceId: string, clientChatId: string): Promise<RunUsageValue[]> {
  return (await liveRecords<RunUsageValue>(tx, 'usage', deviceId))
    .map((row) => row.payload)
    .filter((row) => row.clientChatId === clientChatId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

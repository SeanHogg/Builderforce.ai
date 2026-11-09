/**
 * The per-chat summaries every chat payload carries — ONE call for the routes, so the
 * chat list and the single-chat read can never drift on what a chat "knows" about itself.
 *
 *   ticket health  — `ticketCount` / `ticketProgressPct` (the health ring, the picker's %)
 *                    and `ticketOpenCount` / `ticketDoneCount` (the row's open / done tickets)
 *   spend & saved  — `spend` (`spendSavingsSummary`): what the conversation cost, split
 *                    platform / your key, and what memory saved it
 *
 * Both are one grouped query for the whole set, run side by side — the spend pill costs
 * the surfaces no request of its own: it arrives on the chat they already fetch.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ChatTicketService } from './ChatTicketService';
import type { ChatTicketSummaryFields } from './chatTicketSummaries';
import { chatsSpendSavings, type SpendSavingsSummary } from '../llm/spendSavingsSummary';

export type ChatSummaryFields = ChatTicketSummaryFields & {
  /** Null when the chat has no usage yet. */
  spend: SpendSavingsSummary | null;
};

export async function attachChatSummaries<T extends { id: number }>(
  env: Env,
  db: Db,
  tenantId: number,
  rows: T[],
): Promise<Array<T & ChatSummaryFields>> {
  const [withTickets, spend] = await Promise.all([
    new ChatTicketService(db, env).attachChatTicketSummaries(tenantId, rows),
    // Spend is an enrichment: a usage-database hiccup must not fail the chat read.
    chatsSpendSavings(env, db, tenantId, rows.map((r) => r.id)).catch(() => new Map<number, SpendSavingsSummary>()),
  ]);
  return withTickets.map((r) => ({ ...r, spend: spend.get(r.id) ?? null }));
}

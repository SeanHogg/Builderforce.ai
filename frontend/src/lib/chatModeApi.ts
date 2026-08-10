import { apiRequest } from './apiClient';
import type { ChatMode } from './brain';

/**
 * "Conversations vs Executions" lens — client mirror of
 * api/src/application/insights/chatModeInsights.ts (`computeChatModeUsage`, served
 * by `GET /api/insights/chat-modes`).
 *
 * The question: of everything people start here, how much is a CONVERSATION and how
 * much is WORK actually being handed over — and of the work handed over, how much of
 * it a machine actually picked up. Before migration 0409 that could not be asked:
 * every Brain conversation ran under the same always-execute directive, so asking and
 * delegating were the same event in the data.
 *
 * Manager-gated server-side (it exposes tenant-wide spend).
 */

export interface ChatModeUsageRow {
  mode: string;
  conversations: number;
  engaged: number;
  ticketsLinked: number;
  ticketsDispatched: number;
  totalTokens: number;
  /** USD millicents — the unit `llm_usage_log` stamps at write time. */
  costUsdMillicents: number;
}

export interface ChatModeUsage {
  generatedAt: string;
  windowDays: number;
  rows: ChatModeUsageRow[];
  canvasSessions: Array<{ mode: string; sessions: number }>;
}

/** Stable, ordered mode list — drives colour identity and a deterministic legend.
 *  Colour follows the MODE (the entity), never its rank in the response, so a
 *  window change never repaints the survivors. */
export const MODE_ORDER: ChatMode[] = ['chat', 'work'];

/** The row for a mode, or a zeroed one — so a mode with no activity still renders as
 *  an honest zero rather than vanishing from the comparison. */
export function rowFor(data: ChatModeUsage | null | undefined, mode: string): ChatModeUsageRow {
  return (
    data?.rows.find((r) => r.mode === mode)
    ?? { mode, conversations: 0, engaged: 0, ticketsLinked: 0, ticketsDispatched: 0, totalTokens: 0, costUsdMillicents: 0 }
  );
}

/**
 * The EXECUTION RATE for a mode: of the work items its conversations opened, what
 * share ever had a run dispatched. This is the number the whole split exists to
 * expose — a Work mode that opens tickets nothing ever runs is failing quietly.
 * Returns null when nothing was linked (no denominator ⇒ no rate, not 0%).
 */
export function executionRate(row: ChatModeUsageRow): number | null {
  return row.ticketsLinked > 0 ? row.ticketsDispatched / row.ticketsLinked : null;
}

/** A mode's share of total spend across the window. Null when nothing was spent. */
export function costShare(data: ChatModeUsage | null | undefined, mode: string): number | null {
  const total = (data?.rows ?? []).reduce((sum, r) => sum + r.costUsdMillicents, 0);
  return total > 0 ? rowFor(data, mode).costUsdMillicents / total : null;
}

export const chatModeApi = {
  get: (days = 30): Promise<ChatModeUsage> =>
    apiRequest<ChatModeUsage>(`/api/insights/chat-modes?days=${encodeURIComponent(String(days))}`),
};

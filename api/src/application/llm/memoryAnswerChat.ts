/**
 * The CHAT behind a memory-first answer request, resolved on the server.
 *
 * `GET/POST /api/projects/:id/answer` and `POST …/facts` used to take the chat id, and
 * the producing turn's model and token counts, from the caller — and the cost basis was
 * then recorded as a MEASURED saving. Both halves now come from records the server owns:
 *
 *   • the chat is resolved through THE shared chat-access guard (`resolveChatAccess`:
 *     tenant-scoped, and owner / member / shared-teammate for a person; tenant-wide for
 *     an agent host, which acts for no person), and its `memory_enabled` switch is
 *     honoured — a conversation with memory off neither replays nor writes memory;
 *   • the origin cost is that chat's own latest real model call on the usage ledger
 *     (`llm_usage_log`, `calls >= 1`, inside a short window). No such row → no origin,
 *     and a replay of the answer is recorded as ESTIMATED (and capped) instead.
 */

import { and, desc, eq, gt, gte } from 'drizzle-orm';
import { brainChats, llmUsageLog } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { resolveChatAccess } from '../brain/chatAccess';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { usageDatabaseOf } from './usageLedger';
import type { FactOriginCost } from './projectFactsStore';

/** A chat a memory-first request may act for. */
export interface AnswerChat {
  chatId: number;
  memoryEnabled: boolean;
}

/** How far back the producing turn's usage row may be — the answer is cached right
 *  after the turn that wrote it, so anything older belongs to a different turn. */
export const ANSWER_ORIGIN_WINDOW_MS = 15 * 60 * 1000;

/** A positive server chat id, or null (absent, malformed, or a local-first negative id). */
export function parseAnswerChatId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The chat, when the caller may act for it; null when it does not exist in this tenant
 * or the person may not access it. `userId` null = an agent host (tenant-wide).
 */
export async function resolveAnswerChat(
  db: Db,
  params: { tenantId: number; userId: string | null; chatId: number },
): Promise<AnswerChat | null> {
  const chat = await resolveChatAccess(db, {
    chatId: params.chatId,
    tenantId: params.tenantId,
    userId: params.userId,
    selectExtra: { memoryEnabled: brainChats.memoryEnabled },
  });
  if (!chat) return null;
  return { chatId: params.chatId, memoryEnabled: chat.memoryEnabled !== false };
}

/**
 * What producing this chat's latest answer cost, from the chat's OWN latest real model
 * call on the usage ledger — never a caller-supplied figure. Null when there is no such
 * row in the window (the replay is then priced as an estimate).
 */
export async function chatAnswerOrigin(
  db: Db,
  params: { tenantId: number; chatId: number; userId: string | null; now?: Date },
): Promise<FactOriginCost | null> {
  const since = new Date((params.now ?? new Date()).getTime() - ANSWER_ORIGIN_WINDOW_MS);
  const rows = await usageDatabaseOf(db)
    .select({
      model: llmUsageLog.model,
      promptTokens: llmUsageLog.promptTokens,
      completionTokens: llmUsageLog.completionTokens,
    })
    .from(llmUsageLog)
    .where(and(
      eq(llmUsageLog.tenantId, params.tenantId),
      eq(llmUsageLog.chatId, params.chatId),
      // A real call — never an avoided-call (savings) row, which carries calls = 0.
      gt(llmUsageLog.calls, 0),
      gte(llmUsageLog.createdAt, since),
      ...(params.userId ? [eq(llmUsageLog.userId, params.userId)] : []),
    ))
    .orderBy(desc(llmUsageLog.id))
    .limit(1)
    .catch((err: unknown) => {
      // A failed read must not invent a figure: the answer is still cached, and its
      // replays are recorded as estimates. Reported so a broken ledger read is visible.
      reportCaughtError(err, { source: 'memory-answer-chat', operation: 'chat-answer-origin', level: 'warning', context: { tenantId: params.tenantId, chatId: params.chatId } });
      return [] as Array<{ model: string; promptTokens: number; completionTokens: number }>;
    });
  const row = rows[0];
  const model = row?.model?.trim();
  if (!row || !model || model === 'unknown') return null;
  return { model, promptTokens: row.promptTokens, completionTokens: row.completionTokens };
}

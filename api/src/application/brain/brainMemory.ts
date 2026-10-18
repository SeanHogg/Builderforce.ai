/**
 * Brain MEMORY use cases — chat summaries, the chat-memory list, project memory and
 * its consolidation, and agentHost-session summaries. Every LLM call goes through
 * `brainLlmCall.completeTraced`. Split out of `BrainService.ts`.
 */

import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { brainChats, brainChatMessages, chatMemories, chatSessions, chatMessages, projectMemories } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { readTimelineTail } from '../../domain/shared/timelineTail';
// The reasoning channel's LEARNING policy (see `reasoning.ts`): it excises `<think>…`
// blocks IN PLACE and — unlike the display policy `answerTextOf` — never promotes a
// swallowed thought back into the answer, so nothing the model thought can reach a
// summary a user reads or a memory we consolidate.
import { stripReasoningScratchpad } from '@builderforce/agent-loop';
import { readProxyChoice } from '../llm/LlmProxyService';
import { canAccessChat, verifyProjectInTenant } from './brainChatGuards';
import { ADVISORY_THREAD_AI_CONTEXT_ERROR, advisoryChatAdmittedToAiContext } from '../commerce/advisoryReservation';
import { buildTenantLlmService, completeTraced } from './brainLlmCall';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

// -----------------------------------------------------------------------
// Reading an LLM answer out of a raw model response
// -----------------------------------------------------------------------

/**
 * The ANSWER in a raw model response — the text without the model's `<think>…</think>`
 * reasoning, trimmed. The one place memory decides what an LLM actually said.
 *
 * `readProxyChoice` hands back `message.content` VERBATIM, and on every model that
 * reasons inline that content is the scratchpad followed by the answer. Both
 * summarisers in this file materialised it as the chat's summary, so the reasoning
 * was stored on `brain_chats.summary`, shown to the user, and handed to project-memory
 * consolidation as though the model had said it. The closing tag is often missing —
 * the transport caps the completion mid-thought — so a plain `<think>…</think>` regex
 * misses exactly the case that matters most.
 *
 * This is the LEARNING policy rather than the display policy on purpose: a thought
 * block is never promoted back into the answer. A summary that quoted deliberation
 * would teach the next consolidation to quote it too, and would show a user the model
 * arguing with itself about a chat that is already over.
 *
 * Exported so every memory writer uses the SAME reading of a model turn, and so the
 * stripping is unit-testable without a database.
 */
export function answerTextOf(raw: string | null | undefined): string {
  return stripReasoningScratchpad(raw ?? '');
}

// -----------------------------------------------------------------------
// Writing a chat memory
// -----------------------------------------------------------------------

/**
 * Retain `summary` as the memory for a BRAIN chat, keyed on `chatId`.
 *
 * A summary that lives only on `brain_chats.summary` is invisible to everything that
 * reads MEMORY: `listMemories`, `consolidateProjectMemory` (which selects
 * `chat_memories` by tenant + project), and the memory-sync push to agent hosts. The
 * chat row kept the text and the memory table stayed empty, so consolidation had
 * nothing to consolidate however many chats had been summarized.
 *
 * Columns, per `chatMemories` (schema/canvas.ts):
 *   • `tenantId`   — the scoping column every memory read filters on.
 *   • `chatId`     — PROVENANCE, and the conflict target: `.unique()` in the database,
 *                    so one memory per chat and re-summarizing updates rather than
 *                    duplicates. The chat id is the only handle a reader has back to
 *                    the conversation.
 *   • `projectId`  — how consolidation scopes its read; taken from the chat row.
 *   • `summary`    — the CLEANED answer text (never the raw model output).
 *   • `agentHostSessionId` is deliberately NOT set: it is the OTHER kind of memory
 *                    (an agentHost coding session, `summarizeAgentHostSession`), and
 *                    writing it here would claim a session id that does not exist.
 *
 * An upsert, keyed on the chat id, because summarizing a chat twice must leave one
 * memory behind rather than two.
 */
export async function retainChatMemory(
  db: Db,
  args: { tenantId: number; chatId: number; projectId: number | null; summary: string },
): Promise<void> {
  await db
    .insert(chatMemories)
    .values({
      tenantId: args.tenantId,
      chatId: args.chatId,
      projectId: args.projectId,
      summary: args.summary,
    })
    .onConflictDoUpdate({
      target: chatMemories.chatId,
      set: { summary: args.summary, projectId: args.projectId, updatedAt: new Date() },
    });
}

/** `opts.executionCtx` is the request context the trace write rides on. Optional:
 *  a caller without one (cron/internal) still traces, best-effort. */
export async function summarizeChat(db: Db, chatId: number, tenantId: number, userId: string, env: Env, opts?: { executionCtx?: ExecutionContext }) {
  const apiKey = env.OPENROUTER_API_KEY;
  const chat = await canAccessChat(db, chatId, tenantId, userId, {
    projectId: brainChats.projectId,
  }) as { id: number; projectId: number | null } | null;
  if (!chat) return { error: 'Chat not found' as const };
  if (!await advisoryChatAdmittedToAiContext(db, chatId)) {
    return { error: ADVISORY_THREAD_AI_CONTEXT_ERROR };
  }

  const msgs = await readTimelineTail(
    (rows) => db
      .select({ role: brainChatMessages.role, content: brainChatMessages.content })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(desc(brainChatMessages.seq))
      .limit(rows),
    500,
    500,
  );

  if (msgs.length < 2) {
    return { summary: null, reason: 'Not enough messages to summarize' };
  }

  const transcript = msgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

  const systemPrompt = [
    'You are a summarization assistant. Compress the following conversation into a concise memory.',
    'Focus on: key decisions, action items, ideas proposed, context established, and important details.',
    'Output only the summary, no preamble.',
  ].join('\n');

  const service = await buildTenantLlmService(env, tenantId);

  const result = await completeTraced(db, service, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    temperature: 0.2,
    max_tokens: 800,
  } as never, {
    env, ...(opts?.executionCtx ? { executionCtx: opts.executionCtx } : {}),
    apiKey, tenantId, userId, useCase: 'brain_summary',
    chatId, projectId: chat.projectId,
  });

  const { content: rawSummary } = await readProxyChoice(result);

  // The model's raw content can carry its `<think>` reasoning — see `answerTextOf`.
  // It is stripped ONCE here and every materialisation below uses that one text, so
  // the chat row, the returned summary and the stored memory cannot disagree.
  const summary = answerTextOf(rawSummary);

  if (!summary) {
    return { summary: null, reason: 'LLM returned empty response' };
  }

  // Store summary on the unified chat row (Brain Storm chats use brain_chats)
  await db
    .update(brainChats)
    .set({ summary, updatedAt: new Date() })
    .where(scopedToTenant(brainChats, tenantId, eq(brainChats.id, chatId)));

  // …AND as a memory, which is what consolidation, `listMemories` and the memory-sync
  // push to agent hosts read. Without this the summary only existed on the chat row
  // and no chat content ever reached `chat_memories` at all.
  await retainChatMemory(db, { tenantId, chatId, projectId: chat.projectId, summary });

  return { summary };
}

// -----------------------------------------------------------------------
// Memories
// -----------------------------------------------------------------------

export async function listMemories(db: Db, tenantId: number, opts?: { projectId?: string; limit?: number }) {
  const conditions = [eq(chatMemories.tenantId, tenantId)];
  if (opts?.projectId) {
    const pid = Number(opts.projectId);
    if (!Number.isNaN(pid)) conditions.push(eq(chatMemories.projectId, pid));
  }

  return db
    .select({
      id: chatMemories.id,
      chatId: chatMemories.chatId,
      projectId: chatMemories.projectId,
      summary: chatMemories.summary,
      createdAt: chatMemories.createdAt,
      updatedAt: chatMemories.updatedAt,
    })
    .from(chatMemories)
    .where(and(...conditions))
    .orderBy(desc(chatMemories.updatedAt))
    .limit(Math.min(opts?.limit ?? 50, 200));
}

export async function getProjectMemory(db: Db, tenantId: number, projectId: number) {
  const [memory] = await db
    .select({
      id: projectMemories.id,
      projectId: projectMemories.projectId,
      consolidatedSummary: projectMemories.consolidatedSummary,
      createdAt: projectMemories.createdAt,
      updatedAt: projectMemories.updatedAt,
    })
    .from(projectMemories)
    .where(
      and(
        eq(projectMemories.tenantId, tenantId),
        eq(projectMemories.projectId, projectId),
      ),
    )
    .limit(1);

  return memory ?? null;
}

// -----------------------------------------------------------------------
// Project memory consolidation
// -----------------------------------------------------------------------

/** `opts.executionCtx` is the request context the trace write rides on. Optional:
 *  a caller without one (cron/internal) still traces, best-effort. */
export async function consolidateProjectMemory(db: Db, tenantId: number, projectId: number, env: Env, opts?: { executionCtx?: ExecutionContext }) {
  const apiKey = env.OPENROUTER_API_KEY;
  const proj = await verifyProjectInTenant(db, projectId, tenantId);
  if (!proj) return { error: 'Project not found' as const };

  const memories = await db
    .select({ chatId: chatMemories.chatId, summary: chatMemories.summary })
    .from(chatMemories)
    .where(and(eq(chatMemories.tenantId, tenantId), eq(chatMemories.projectId, projectId)))
    .orderBy(chatMemories.updatedAt)
    .limit(100);

  if (memories.length === 0) {
    return { consolidatedSummary: null, reason: 'No chat memories to consolidate' };
  }

  const memoriesText = memories
    .map((m, i) => `Chat ${i + 1}:\n${m.summary}`)
    .join('\n\n---\n\n');

  const systemPrompt = [
    `You are a project memory consolidator for the project "${proj.name}".`,
    'Combine the following individual chat summaries into a single, coherent project memory.',
    'Focus on: overall project context, key decisions across all chats, established patterns,',
    'action items, and important details. Remove redundancy. Be concise but comprehensive.',
    'Output only the consolidated memory, no preamble.',
  ].join('\n');

  const service = await buildTenantLlmService(env, tenantId);

  const result = await completeTraced(db, service, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: memoriesText },
    ],
    temperature: 0.2,
    max_tokens: 1200,
  } as never, {
    env, ...(opts?.executionCtx ? { executionCtx: opts.executionCtx } : {}),
    apiKey, tenantId, useCase: 'brain_project_memory', projectId,
  });

  const { content: rawConsolidated } = await readProxyChoice(result);

  // Cleaned for the same reason as a chat summary (see `answerTextOf`): consolidation
  // runs on a reasoning model too, and its reasoning would otherwise be stored as the
  // project's consolidated memory and pushed to every agent host on the next sync.
  const consolidatedSummary = answerTextOf(rawConsolidated);

  if (!consolidatedSummary) {
    return { consolidatedSummary: null, reason: 'LLM returned empty response' };
  }

  await db
    .insert(projectMemories)
    .values({ tenantId, projectId, consolidatedSummary })
    .onConflictDoUpdate({
      target: projectMemories.projectId,
      set: { consolidatedSummary, updatedAt: new Date() },
    });

  return { consolidatedSummary };
}

// -----------------------------------------------------------------------
// AgentHost session summarisation — bridges agentHost chat history into brain memory
// -----------------------------------------------------------------------

/** `opts.executionCtx` is the request context the trace write rides on. Optional:
 *  a caller without one (cron/internal) still traces, best-effort. */
export async function summarizeAgentHostSession(db: Db, sessionId: number, tenantId: number, env: Env, opts?: { executionCtx?: ExecutionContext }) {
  const apiKey = env.OPENROUTER_API_KEY;
  // Verify session belongs to tenant
  const [session] = await db
    .select({
      id: chatSessions.id,
      projectId: chatSessions.projectId,
      agentHostId: chatSessions.agentHostId,
    })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, tenantId)))
    .limit(1);

  if (!session) return { error: 'Session not found' as const };

  const msgs = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(scopedToTenant(chatMessages, tenantId, eq(chatMessages.sessionId, sessionId)))
    .orderBy(chatMessages.seq)
    .limit(500);

  if (msgs.length < 2) {
    return { summary: null, reason: 'Not enough messages to summarize' };
  }

  const transcript = msgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

  const systemPrompt = [
    'You are a summarization assistant. Compress the following agentHost coding session into a concise memory.',
    'Focus on: what was worked on, key decisions, code changes, bugs found, and important context.',
    'Output only the summary, no preamble.',
  ].join('\n');

  const service = await buildTenantLlmService(env, tenantId);

  const result = await completeTraced(db, service, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    temperature: 0.2,
    max_tokens: 800,
  } as never, {
    env, ...(opts?.executionCtx ? { executionCtx: opts.executionCtx } : {}),
    apiKey, tenantId, useCase: 'brain_summary', projectId: session.projectId,
  });

  const { content: rawSummary } = await readProxyChoice(result);

  // The model's raw content can carry its `<think>` reasoning — see `answerTextOf`.
  const summary = answerTextOf(rawSummary);

  if (!summary) {
    return { summary: null, reason: 'LLM returned empty response' };
  }

  // Store in chatMemories linked via agentHostSessionId for project memory consolidation
  await db
    .insert(chatMemories)
    .values({
      tenantId,
      agentHostSessionId: sessionId,
      projectId: session.projectId,
      summary,
    })
    .onConflictDoUpdate({
      target: chatMemories.agentHostSessionId,
      targetWhere: isNotNull(chatMemories.agentHostSessionId),
      set: { summary, projectId: session.projectId, updatedAt: new Date() },
    });

  return { summary, projectId: session.projectId };
}

/**
 * Brain MEMORY use cases — chat summaries, the chat-memory list, project memory and
 * its consolidation, and agentHost-session summaries. Every LLM call goes through
 * `brainLlmCall.completeTraced`. Split out of `BrainService.ts`.
 */

import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { brainChats, brainChatMessages, chatMemories, chatSessions, chatMessages, projectMemories } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { readTimelineTail } from '../../domain/shared/timelineTail';
// `answerTextOf` is the package's display reader (the name the archive contract
// names). `stripReasoningScratchpad` is its LEARNING policy: it excises `<think>…`
// in place and — unlike the display reader — never promotes a swallowed thought
// back into the answer. A memory write uses the display reading only when the two
// agree, so a summary still goes through `answerTextOf` and a promoted thought
// cannot reach a row we consolidate.
import { answerTextOf as displayAnswerTextOf, stripReasoningScratchpad } from '@builderforce/agent-loop';
import { readProxyChoice } from '../llm/LlmProxyService';
import { upsertProjectFact } from '../llm/projectFactsWrite';
import { currentRequestScope } from '../shared/requestScope';
import { canAccessChat, verifyChatOwnership, verifyProjectInTenant } from './brainChatGuards';
import { bumpChatStructure, bumpTeamChats } from './chatCacheVersions';
import { ADVISORY_THREAD_AI_CONTEXT_ERROR, advisoryChatAdmittedToAiContext } from '../commerce/advisoryReservation';
import { buildTenantLlmService, completeTraced } from './brainLlmCall';
import { deferLlmCall } from '../llm/batch/deferLlmCall';
import type { BatchCallbackHandler } from '../llm/batch/batchCallbacks';
import type { DeferredLlmRequest } from '../llm/batch/batchTypes';
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
  const source = raw ?? '';
  const learned = stripReasoningScratchpad(source);
  // Display rejoins trimmed pieces with paragraph breaks and, when the visible
  // tail is a fragment, promotes the thought that held the real reply. Either
  // change would be stored as a fact. Agreeing with the learning policy is the
  // common case (a closed think block, then a real answer); the disagreement is
  // exactly the case that must not be learned.
  const displayed = displayAnswerTextOf(source);
  return displayed === learned ? displayed : learned;
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

/**
 * THE memory write shared by Summarize and Archive.
 *
 * A summary that lands only on `brain_chats.summary` is invisible to memory readers,
 * and one that lands only in `chat_memories` is invisible to project-fact recall.
 * Both callers go through here so the two rows cannot drift: the cleaned answer is
 * upserted as the chat's memory, and — when the chat belongs to a project — written
 * through as the fact `chat-summary:<chatId>`.
 *
 * Cleaning is {@link answerTextOf}, the same reading every other memory writer uses.
 * An empty result writes nothing: archiving a chat that was never summarized must
 * not invent a memory, and must not invent a fact either.
 *
 * `env` is optional. Summarize already holds one and passes it. Archive's HTTP
 * caller does not, and threading one through the facade would change a signature
 * this module does not own — the Worker entry point already stores `c.env` on the
 * request scope, which is how every other `Db`-only writer reaches it. With no env
 * (a test, a bare script) the fact write is skipped; the memory row still lands.
 * `upsertProjectFact` cannot embed without an env, and a thrown embed must not
 * turn an archive into a failed delete.
 */
export async function archiveChatMemory(
  db: Db,
  args: {
    tenantId: number;
    chatId: number;
    projectId: number | null;
    summary: string;
    env?: Env | null;
  },
): Promise<void> {
  const summary = answerTextOf(args.summary);
  if (!summary) return;
  await retainChatMemory(db, {
    tenantId: args.tenantId,
    chatId: args.chatId,
    projectId: args.projectId,
    summary,
  });
  const projectId = args.projectId;
  if (projectId == null || !Number.isInteger(projectId) || projectId <= 0) return;
  const env = args.env ?? (currentRequestScope()?.env as Env | undefined);
  if (!env) return;
  await upsertProjectFact(
    env,
    db,
    args.tenantId,
    projectId,
    `chat-summary:${args.chatId}`,
    summary,
    'chat-archive',
  );
}

/**
 * Archive a chat and keep the summary it already earned.
 *
 * One use case, not a flag plus a side write: (a) the summary is read through
 * {@link answerTextOf} (the package display reader, falling back to the learning
 * policy when that reader would store a swallowed thought), (b) that text is
 * written as a `chat_memories` row and, when the chat belongs to a project, as
 * the fact `chat-summary:<chatId>`, (c) `brain_chats.isArchived` is set. It
 * reuses the summary already on the chat, so archiving costs no LLM call and
 * invents nothing. Env for the fact write comes from the request scope (the
 * DELETE handler does not thread one); without it the fact write is skipped,
 * the memory row is not.
 */
export async function archiveChat(db: Db, chatId: number, tenantId: number, userId: string, options: { isWorkspaceAdmin?: boolean } = {}) {
  // `summary` + `projectId` are selected for the memory write below; the ownership
  // gate's own return type is narrowed to `{ id, origin }`, so the extra columns are
  // re-stated here — the same `as` cast `summarizeChat` uses on `canAccessChat`.
  const existing = await verifyChatOwnership(
    db,
    chatId,
    tenantId,
    userId,
    { summary: brainChats.summary, projectId: brainChats.projectId },
    options,
  ) as { id: number; origin: string; summary: string | null; projectId: number | null } | null;
  if (!existing) return { error: 'Chat not found' as const };

  await db
    .update(brainChats)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(scopedToTenant(brainChats, tenantId, eq(brainChats.id, chatId)));

  await archiveChatMemory(db, {
    tenantId,
    chatId,
    projectId: existing.projectId,
    summary: existing.summary ?? '',
  });

  await Promise.all([bumpChatStructure(chatId), bumpTeamChats(tenantId)]);

  return { ok: true };
}

/** `opts.executionCtx` is the request context the trace write rides on. Optional:
 *  a caller without one (cron/internal) still traces, best-effort. */
export async function summarizeChat(db: Db, chatId: number, tenantId: number, userId: string, env: Env, opts?: { executionCtx?: ExecutionContext }) {
  const apiKey = env.OPENROUTER_API_KEY;
  const chat = await canAccessChat(db, chatId, tenantId, userId, {
    projectId: brainChats.projectId,
  }) as { id: number; projectId: number | null } | null;
  if (!chat) return { error: 'Chat not found' as const };
  if (!await advisoryChatAdmittedToAiContext(db, chatId, env)) {
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

  // …AND as a memory plus, when the chat has a project, the `chat-summary:<id>` fact.
  // Same use case Archive runs, so Summarize and Archive cannot drift. The chat
  // row above is `summary` + `updatedAt` only — never `title`.
  await archiveChatMemory(db, { tenantId, chatId, projectId: chat.projectId, summary, env });

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

/**
 * How a background memory call is answered. The default is DEFERRED (PRD D6, lever
 * `d6_batch_api`): nothing in the product waits on a consolidation or an agentHost
 * session summary — the stored memory is what its readers (the memory list, memory-sync,
 * recall) use — so the call rides a provider batch at half price and the batch handler
 * below does the store. `wait: true` keeps the synchronous call for a caller that needs
 * the text in its response. A tenant the lever is off for, or with no batchable
 * provider, runs synchronously either way.
 */
export interface BackgroundMemoryOptions {
  executionCtx?: ExecutionContext;
  wait?: boolean;
}

/** The consolidation request, shared by the synchronous call and the deferred job. */
function projectMemoryRequest(projectName: string, memories: ReadonlyArray<{ summary: string }>): DeferredLlmRequest {
  const memoriesText = memories
    .map((m, i) => `Chat ${i + 1}:\n${m.summary}`)
    .join('\n\n---\n\n');

  const systemPrompt = [
    `You are a project memory consolidator for the project "${projectName}".`,
    'Combine the following individual chat summaries into a single, coherent project memory.',
    'Focus on: overall project context, key decisions across all chats, established patterns,',
    'action items, and important details. Remove redundancy. Be concise but comprehensive.',
    'Output only the consolidated memory, no preamble.',
  ].join('\n');

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: memoriesText },
    ],
    temperature: 0.2,
    maxTokens: 1200,
  };
}

/** The gateway body for a deferred-shape request — the synchronous path's call. */
function gatewayBody(request: DeferredLlmRequest): never {
  return { messages: request.messages, temperature: request.temperature, max_tokens: request.maxTokens } as never;
}

/**
 * Store a consolidation answer — the tail both paths share. Cleaned for the same reason
 * as a chat summary (see `answerTextOf`): consolidation runs on a reasoning model too, and
 * its reasoning would otherwise be stored as the project's consolidated memory and pushed
 * to every agent host on the next sync. Returns null when the answer was empty.
 */
async function storeProjectMemory(db: Db, tenantId: number, projectId: number, raw: string): Promise<string | null> {
  const consolidatedSummary = answerTextOf(raw);
  if (!consolidatedSummary) return null;
  await db
    .insert(projectMemories)
    .values({ tenantId, projectId, consolidatedSummary })
    .onConflictDoUpdate({
      target: projectMemories.projectId,
      set: { consolidatedSummary, updatedAt: new Date() },
    });
  return consolidatedSummary;
}

/** `opts.executionCtx` is the request context the trace write rides on. Optional:
 *  a caller without one (cron/internal) still traces, best-effort. Deferred by default —
 *  see {@link BackgroundMemoryOptions}. */
export async function consolidateProjectMemory(db: Db, tenantId: number, projectId: number, env: Env, opts?: BackgroundMemoryOptions) {
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

  const request = projectMemoryRequest(proj.name, memories);

  if (!opts?.wait) {
    const queued = await deferLlmCall(env, db, {
      tenantId, projectId, kind: 'project_memory', request, payload: { projectId },
    });
    if (queued.deferred) {
      // Readers keep the current consolidation until the batch lands.
      const current = await getProjectMemory(db, tenantId, projectId);
      return { consolidatedSummary: current?.consolidatedSummary ?? null, deferred: true as const, jobId: queued.jobId };
    }
  }

  const service = await buildTenantLlmService(env, tenantId);

  const result = await completeTraced(db, service, gatewayBody(request), {
    env, ...(opts?.executionCtx ? { executionCtx: opts.executionCtx } : {}),
    apiKey, tenantId, useCase: 'brain_project_memory', projectId,
  });

  const { content: rawConsolidated } = await readProxyChoice(result);
  const consolidatedSummary = await storeProjectMemory(db, tenantId, projectId, rawConsolidated);

  if (!consolidatedSummary) {
    return { consolidatedSummary: null, reason: 'LLM returned empty response' };
  }

  return { consolidatedSummary };
}

/** Settles a deferred consolidation with the store the synchronous call does. */
export const projectMemoryBatchHandler: BatchCallbackHandler = {
  async settle({ db }, job, completion) {
    const projectId = Number(job.callbackPayload.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('project_memory job has no projectId');
    // The project may have left the tenant while the batch ran.
    if (!await verifyProjectInTenant(db, projectId, job.tenantId)) return;
    if (!await storeProjectMemory(db, job.tenantId, projectId, completion.content)) {
      throw new Error('LLM returned empty response');
    }
  },
};

// -----------------------------------------------------------------------
// AgentHost session summarisation — bridges agentHost chat history into brain memory
// -----------------------------------------------------------------------

/** The agentHost-session summary request, shared by the synchronous call and the job. */
function agentHostSessionRequest(msgs: ReadonlyArray<{ role: string; content: string }>): DeferredLlmRequest {
  const transcript = msgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

  const systemPrompt = [
    'You are a summarization assistant. Compress the following agentHost coding session into a concise memory.',
    'Focus on: what was worked on, key decisions, code changes, bugs found, and important context.',
    'Output only the summary, no preamble.',
  ].join('\n');

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    temperature: 0.2,
    maxTokens: 800,
  };
}

/** Store a session summary in chatMemories, linked via agentHostSessionId for project
 *  memory consolidation — the tail both paths share. Null when the answer was empty. */
async function storeAgentHostSessionSummary(
  db: Db,
  tenantId: number,
  sessionId: number,
  projectId: number | null,
  raw: string,
): Promise<string | null> {
  // The model's raw content can carry its `<think>` reasoning — see `answerTextOf`.
  const summary = answerTextOf(raw);
  if (!summary) return null;
  await db
    .insert(chatMemories)
    .values({
      tenantId,
      agentHostSessionId: sessionId,
      projectId,
      summary,
    })
    .onConflictDoUpdate({
      target: chatMemories.agentHostSessionId,
      targetWhere: isNotNull(chatMemories.agentHostSessionId),
      set: { summary, projectId, updatedAt: new Date() },
    });
  return summary;
}

/** `opts.executionCtx` is the request context the trace write rides on. Optional:
 *  a caller without one (cron/internal) still traces, best-effort. Deferred by default —
 *  see {@link BackgroundMemoryOptions}. */
export async function summarizeAgentHostSession(db: Db, sessionId: number, tenantId: number, env: Env, opts?: BackgroundMemoryOptions) {
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

  const request = agentHostSessionRequest(msgs);

  if (!opts?.wait) {
    const queued = await deferLlmCall(env, db, {
      tenantId,
      projectId: session.projectId,
      kind: 'agent_host_session_summary',
      request,
      payload: { sessionId, projectId: session.projectId },
    });
    if (queued.deferred) return { summary: null, projectId: session.projectId, deferred: true as const, jobId: queued.jobId };
  }

  const service = await buildTenantLlmService(env, tenantId);

  const result = await completeTraced(db, service, gatewayBody(request), {
    env, ...(opts?.executionCtx ? { executionCtx: opts.executionCtx } : {}),
    apiKey, tenantId, useCase: 'brain_summary', projectId: session.projectId,
  });

  const { content: rawSummary } = await readProxyChoice(result);
  const summary = await storeAgentHostSessionSummary(db, tenantId, sessionId, session.projectId, rawSummary);

  if (!summary) {
    return { summary: null, reason: 'LLM returned empty response' };
  }

  return { summary, projectId: session.projectId };
}

/** Settles a deferred agentHost-session summary with the store the synchronous call does. */
export const agentHostSessionBatchHandler: BatchCallbackHandler = {
  async settle({ db }, job, completion) {
    const sessionId = Number(job.callbackPayload.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error('agent_host_session_summary job has no sessionId');
    // The session may have been deleted while the batch ran; its project is re-read so a
    // move between projects lands the memory where the session now is.
    const [session] = await db
      .select({ id: chatSessions.id, projectId: chatSessions.projectId })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, job.tenantId)))
      .limit(1);
    if (!session) return;
    if (!await storeAgentHostSessionSummary(db, job.tenantId, sessionId, session.projectId, completion.content)) {
      throw new Error('LLM returned empty response');
    }
  },
};

/**
 * Brain MEMORY use cases — chat summaries, the chat-memory list, project memory and
 * its consolidation, and agentHost-session summaries. Every LLM call goes through
 * `brainLlmCall.completeTraced`. Split out of `BrainService.ts`.
 */

import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { brainChats, brainChatMessages, chatMemories, chatSessions, chatMessages, projectMemories } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { readTimelineTail } from '../../domain/shared/timelineTail';
import { readProxyChoice } from '../llm/LlmProxyService';
import { canAccessChat, verifyProjectInTenant } from './brainChatGuards';
import { buildTenantLlmService, completeTraced } from './brainLlmCall';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** `opts.executionCtx` is the request context the trace write rides on. Optional:
 *  a caller without one (cron/internal) still traces, best-effort. */
export async function summarizeChat(db: Db, chatId: number, tenantId: number, userId: string, env: Env, opts?: { executionCtx?: ExecutionContext }) {
  const apiKey = env.OPENROUTER_API_KEY;
  const chat = await canAccessChat(db, chatId, tenantId, userId, {
    projectId: brainChats.projectId,
  }) as { id: number; projectId: number | null } | null;
  if (!chat) return { error: 'Chat not found' as const };

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

  const { content: summary } = await readProxyChoice(result);

  if (!summary) {
    return { summary: null, reason: 'LLM returned empty response' };
  }

  // Store summary on the unified chat row (Brain Storm chats use brain_chats)
  await db
    .update(brainChats)
    .set({ summary, updatedAt: new Date() })
    .where(scopedToTenant(brainChats, tenantId, eq(brainChats.id, chatId)));

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

  const { content: consolidatedSummary } = await readProxyChoice(result);

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

  const { content: summary } = await readProxyChoice(result);

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

import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import {
  ideProjectChats,
  ideProjectChatMessages,
  chatMemories,
  chatSessions,
  chatMessages,
  projectMemories,
  projects,
} from '../../infrastructure/database/schema';
import { ideProxy } from '../llm/LlmProxyService';
import type { Db } from '../../infrastructure/database/connection';

const BRAIN_ORIGIN = 'brainstorm';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateChatDto {
  tenantId: number;
  userId: string;
  title?: string;
  projectId?: number | null;
}

export interface UpdateChatDto {
  title?: string;
  projectId?: number | null;
}

export interface AppendMessagesDto {
  messages: Array<{ role: string; content: string; metadata?: string }>;
}

// ---------------------------------------------------------------------------
// Return shapes (presentation-agnostic) — unified project chats, origin=brainstorm
// ---------------------------------------------------------------------------

const chatColumns = {
  id: ideProjectChats.id,
  projectId: ideProjectChats.projectId,
  origin: ideProjectChats.origin,
  title: ideProjectChats.title,
  createdAt: ideProjectChats.createdAt,
  updatedAt: ideProjectChats.updatedAt,
} as const;

const chatDetailColumns = {
  ...chatColumns,
  isArchived: ideProjectChats.isArchived,
} as const;

const messageColumns = {
  id: ideProjectChatMessages.id,
  role: ideProjectChatMessages.role,
  content: ideProjectChatMessages.content,
  metadata: ideProjectChatMessages.metadata,
  seq: ideProjectChatMessages.seq,
  createdAt: ideProjectChatMessages.createdAt,
} as const;

type MessageFeedback = 'up' | 'down' | null;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application service: orchestrates Brain chat use-cases.
 *
 * Encapsulates ownership checks, CRUD, LLM summarisation and project-memory
 * consolidation. The presentation layer delegates here and only maps HTTP ↔ DTO.
 */
export class BrainService {
  constructor(private readonly db: Db) {}

  // -----------------------------------------------------------------------
  // Ownership guard (DRY — used by every chat-scoped operation)
  // -----------------------------------------------------------------------

  private async verifyChatOwnership(
    chatId: number,
    tenantId: number,
    userId: string,
    selectExtra?: Record<string, unknown>,
  ) {
    const columns = { id: ideProjectChats.id, ...(selectExtra ?? {}) };
    const [chat] = await this.db
      .select(columns as typeof columns & { id: typeof ideProjectChats.id })
      .from(ideProjectChats)
      .where(
        and(
          eq(ideProjectChats.id, chatId),
          eq(ideProjectChats.tenantId, tenantId),
          eq(ideProjectChats.userId, userId),
          eq(ideProjectChats.origin, BRAIN_ORIGIN),
        ),
      )
      .limit(1);
    return chat ?? null;
  }

  private async verifyProjectInTenant(projectId: number, tenantId: number) {
    const [proj] = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    return proj ?? null;
  }

  // -----------------------------------------------------------------------
  // LLM helper (DRY)
  // -----------------------------------------------------------------------

  // Caller passes the OpenRouter key; `ideProxy` handles pool + productName.
  // Cross-vendor fallbacks (Cerebras / Ollama) are not enabled here because
  // the BrainService doesn't carry the full env — internal summarization stays
  // single-vendor on purpose.
  private buildLlmService(apiKey: string) {
    return ideProxy({ OPENROUTER_API_KEY: apiKey });
  }

  // -----------------------------------------------------------------------
  // Chat CRUD
  // -----------------------------------------------------------------------

  async listChats(
    tenantId: number,
    userId: string,
    opts?: { projectId?: string; limit?: number; offset?: number },
  ) {
    const conditions = [
      eq(ideProjectChats.tenantId, tenantId),
      eq(ideProjectChats.userId, userId),
      eq(ideProjectChats.origin, BRAIN_ORIGIN),
      eq(ideProjectChats.isArchived, false),
    ];

    if (opts?.projectId === 'none') {
      conditions.push(isNull(ideProjectChats.projectId));
    } else if (opts?.projectId) {
      const pid = Number(opts.projectId);
      if (!Number.isNaN(pid)) conditions.push(eq(ideProjectChats.projectId, pid));
    }

    const limit = Math.min(opts?.limit ?? 50, 200);
    const offset = opts?.offset ?? 0;

    return this.db
      .select(chatColumns)
      .from(ideProjectChats)
      .where(and(...conditions))
      .orderBy(desc(ideProjectChats.updatedAt))
      .limit(limit)
      .offset(offset);
  }

  async createChat(dto: CreateChatDto) {
    const title = dto.title?.trim() || 'New chat';

    if (dto.projectId != null) {
      const proj = await this.verifyProjectInTenant(dto.projectId, dto.tenantId);
      if (!proj) return { error: 'Project not found in tenant' as const };
    }

    const [chat] = await this.db
      .insert(ideProjectChats)
      .values({
        tenantId: dto.tenantId,
        userId: dto.userId,
        origin: BRAIN_ORIGIN,
        projectId: dto.projectId ?? null,
        title,
      })
      .returning(chatColumns);

    return chat;
  }

  async getChat(chatId: number, tenantId: number, userId: string) {
    const [chat] = await this.db
      .select(chatDetailColumns)
      .from(ideProjectChats)
      .where(
        and(
          eq(ideProjectChats.id, chatId),
          eq(ideProjectChats.tenantId, tenantId),
          eq(ideProjectChats.userId, userId),
          eq(ideProjectChats.origin, BRAIN_ORIGIN),
        ),
      )
      .limit(1);
    return chat ?? null;
  }

  async updateChat(
    chatId: number,
    tenantId: number,
    userId: string,
    dto: UpdateChatDto,
  ) {
    const existing = await this.verifyChatOwnership(chatId, tenantId, userId);
    if (!existing) return { error: 'Chat not found' as const };

    if (dto.projectId != null) {
      const proj = await this.verifyProjectInTenant(dto.projectId, tenantId);
      if (!proj) return { error: 'Project not found in tenant' as const };
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.title !== undefined) updates.title = dto.title.trim() || 'New chat';
    if (dto.projectId !== undefined) updates.projectId = dto.projectId;

    const [updated] = await this.db
      .update(ideProjectChats)
      .set(updates)
      .where(eq(ideProjectChats.id, chatId))
      .returning(chatColumns);

    return updated;
  }

  async archiveChat(chatId: number, tenantId: number, userId: string) {
    const existing = await this.verifyChatOwnership(chatId, tenantId, userId);
    if (!existing) return { error: 'Chat not found' as const };

    await this.db
      .update(ideProjectChats)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(ideProjectChats.id, chatId));

    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Messages
  // -----------------------------------------------------------------------

  async getMessages(chatId: number, tenantId: number, userId: string, limit = 100) {
    const chat = await this.verifyChatOwnership(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };

    const msgs = await this.db
      .select(messageColumns)
      .from(ideProjectChatMessages)
      .where(eq(ideProjectChatMessages.chatId, chatId))
      .orderBy(ideProjectChatMessages.seq)
      .limit(Math.min(limit, 500));

    return msgs;
  }

  async appendMessages(
    chatId: number,
    tenantId: number,
    userId: string,
    dto: AppendMessagesDto,
  ) {
    const chat = await this.verifyChatOwnership(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };

    if (!Array.isArray(dto.messages) || dto.messages.length === 0) {
      return { error: 'messages array is required' as const };
    }

    // Get current max seq
    const [maxRow] = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${ideProjectChatMessages.seq}), 0)` })
      .from(ideProjectChatMessages)
      .where(eq(ideProjectChatMessages.chatId, chatId));
    let seq = maxRow?.maxSeq ?? 0;

    const inserted: Array<{
      id: number;
      role: string;
      content: string;
      metadata: string | null;
      seq: number;
      createdAt: Date;
    }> = [];

    for (const msg of dto.messages) {
      if (!msg.role || typeof msg.content !== 'string') continue;
      seq += 1;
      const [row] = await this.db
        .insert(ideProjectChatMessages)
        .values({
          chatId,
          role: msg.role,
          content: msg.content,
          metadata: msg.metadata ?? null,
          seq,
        })
        .returning(messageColumns);
      if (row) inserted.push(row);
    }

    // Touch updatedAt on the chat
    await this.db
      .update(ideProjectChats)
      .set({ updatedAt: new Date() })
      .where(eq(ideProjectChats.id, chatId));

    return inserted;
  }

  // -----------------------------------------------------------------------
  // Message feedback
  // -----------------------------------------------------------------------

  async setMessageFeedback(
    messageId: number,
    tenantId: number,
    userId: string,
    feedback: MessageFeedback,
  ) {
    // Find the message and verify ownership through its chat
    const [msg] = await this.db
      .select({
        id: ideProjectChatMessages.id,
        chatId: ideProjectChatMessages.chatId,
        metadata: ideProjectChatMessages.metadata,
      })
      .from(ideProjectChatMessages)
      .where(eq(ideProjectChatMessages.id, messageId));
    if (!msg) return { error: 'Message not found' as const };

    // Verify ownership of the parent chat
    const chat = await this.verifyChatOwnership(msg.chatId, tenantId, userId);
    if (!chat) return { error: 'Message not found' as const };

    // Merge feedback into existing metadata JSON
    const existing = msg.metadata ? JSON.parse(msg.metadata) : {};
    existing.feedback = feedback;

    const [updated] = await this.db
      .update(ideProjectChatMessages)
      .set({ metadata: JSON.stringify(existing) })
      .where(eq(ideProjectChatMessages.id, messageId))
      .returning(messageColumns);

    return updated ?? { error: 'Update failed' as const };
  }

  // -----------------------------------------------------------------------
  // Summarisation
  // -----------------------------------------------------------------------

  async summarizeChat(chatId: number, tenantId: number, userId: string, apiKey: string) {
    const chat = await this.verifyChatOwnership(chatId, tenantId, userId, {
      projectId: ideProjectChats.projectId,
    }) as { id: number; projectId: number | null } | null;
    if (!chat) return { error: 'Chat not found' as const };

    const msgs = await this.db
      .select({ role: ideProjectChatMessages.role, content: ideProjectChatMessages.content })
      .from(ideProjectChatMessages)
      .where(eq(ideProjectChatMessages.chatId, chatId))
      .orderBy(ideProjectChatMessages.seq)
      .limit(500);

    if (msgs.length < 2) {
      return { summary: null, reason: 'Not enough messages to summarize' };
    }

    const transcript = msgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

    const systemPrompt = [
      'You are a summarization assistant. Compress the following conversation into a concise memory.',
      'Focus on: key decisions, action items, ideas proposed, context established, and important details.',
      'Output only the summary, no preamble.',
    ].join('\n');

    const service = this.buildLlmService(apiKey);

    const result = await service.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    const response = result.response as { choices?: Array<{ message?: { content?: string } }> } | undefined;
    const summary = response?.choices?.[0]?.message?.content?.trim() ?? '';

    if (!summary) {
      return { summary: null, reason: 'LLM returned empty response' };
    }

    // Store summary on the unified chat row (Brain Storm chats use ide_project_chats)
    await this.db
      .update(ideProjectChats)
      .set({ summary, updatedAt: new Date() })
      .where(eq(ideProjectChats.id, chatId));

    return { summary };
  }

  // -----------------------------------------------------------------------
  // Memories
  // -----------------------------------------------------------------------

  async listMemories(tenantId: number, opts?: { projectId?: string; limit?: number }) {
    const conditions = [eq(chatMemories.tenantId, tenantId)];
    if (opts?.projectId) {
      const pid = Number(opts.projectId);
      if (!Number.isNaN(pid)) conditions.push(eq(chatMemories.projectId, pid));
    }

    return this.db
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

  async getProjectMemory(tenantId: number, projectId: number) {
    const [memory] = await this.db
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

  async consolidateProjectMemory(tenantId: number, projectId: number, apiKey: string) {
    const proj = await this.verifyProjectInTenant(projectId, tenantId);
    if (!proj) return { error: 'Project not found' as const };

    const memories = await this.db
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

    const service = this.buildLlmService(apiKey);

    const result = await service.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: memoriesText },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    });

    const response = result.response as { choices?: Array<{ message?: { content?: string } }> } | undefined;
    const consolidatedSummary = response?.choices?.[0]?.message?.content?.trim() ?? '';

    if (!consolidatedSummary) {
      return { consolidatedSummary: null, reason: 'LLM returned empty response' };
    }

    await this.db
      .insert(projectMemories)
      .values({ tenantId, projectId, consolidatedSummary })
      .onConflictDoUpdate({
        target: projectMemories.projectId,
        set: { consolidatedSummary, updatedAt: new Date() },
      });

    return { consolidatedSummary };
  }

  // -----------------------------------------------------------------------
  // Claw session summarisation — bridges claw chat history into brain memory
  // -----------------------------------------------------------------------

  async summarizeClawSession(sessionId: number, tenantId: number, apiKey: string) {
    // Verify session belongs to tenant
    const [session] = await this.db
      .select({
        id: chatSessions.id,
        projectId: chatSessions.projectId,
        clawId: chatSessions.clawId,
      })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, tenantId)))
      .limit(1);

    if (!session) return { error: 'Session not found' as const };

    const msgs = await this.db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.seq)
      .limit(500);

    if (msgs.length < 2) {
      return { summary: null, reason: 'Not enough messages to summarize' };
    }

    const transcript = msgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

    const systemPrompt = [
      'You are a summarization assistant. Compress the following claw coding session into a concise memory.',
      'Focus on: what was worked on, key decisions, code changes, bugs found, and important context.',
      'Output only the summary, no preamble.',
    ].join('\n');

    const service = this.buildLlmService(apiKey);

    const result = await service.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    const response = result.response as { choices?: Array<{ message?: { content?: string } }> } | undefined;
    const summary = response?.choices?.[0]?.message?.content?.trim() ?? '';

    if (!summary) {
      return { summary: null, reason: 'LLM returned empty response' };
    }

    // Store in chatMemories linked via clawSessionId for project memory consolidation
    await this.db
      .insert(chatMemories)
      .values({
        tenantId,
        clawSessionId: sessionId,
        projectId: session.projectId,
        summary,
      })
      .onConflictDoUpdate({
        target: chatMemories.clawSessionId,
        set: { summary, projectId: session.projectId, updatedAt: new Date() },
      });

    return { summary, projectId: session.projectId };
  }
}

import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import {
  brainChats,
  brainMessages,
  chatMemories,
  chatSessions,
  chatMessages,
  projectMemories,
  projects,
} from '../../infrastructure/database/schema';
import {
  LlmProxyService,
  FREE_MODEL_POOL,
} from '../llm/LlmProxyService';
import type { Db } from '../../infrastructure/database/connection';

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
// Return shapes (presentation-agnostic)
// ---------------------------------------------------------------------------

const chatColumns = {
  id: brainChats.id,
  projectId: brainChats.projectId,
  title: brainChats.title,
  createdAt: brainChats.createdAt,
  updatedAt: brainChats.updatedAt,
} as const;

const chatDetailColumns = {
  ...chatColumns,
  isArchived: brainChats.isArchived,
} as const;

const messageColumns = {
  id: brainMessages.id,
  role: brainMessages.role,
  content: brainMessages.content,
  metadata: brainMessages.metadata,
  seq: brainMessages.seq,
  createdAt: brainMessages.createdAt,
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
    const columns = { id: brainChats.id, ...(selectExtra ?? {}) };
    const [chat] = await this.db
      .select(columns as typeof columns & { id: typeof brainChats.id })
      .from(brainChats)
      .where(
        and(
          eq(brainChats.id, chatId),
          eq(brainChats.tenantId, tenantId),
          eq(brainChats.userId, userId),
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

  private buildLlmService(apiKey: string) {
    return new LlmProxyService(apiKey, {
      modelPool: FREE_MODEL_POOL,
      preferredPoolSize: 2,
      productName: 'coderClawLLM',
    });
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
      eq(brainChats.tenantId, tenantId),
      eq(brainChats.userId, userId),
      eq(brainChats.isArchived, false),
    ];

    if (opts?.projectId === 'none') {
      conditions.push(isNull(brainChats.projectId));
    } else if (opts?.projectId) {
      const pid = Number(opts.projectId);
      if (!Number.isNaN(pid)) conditions.push(eq(brainChats.projectId, pid));
    }

    const limit = Math.min(opts?.limit ?? 50, 200);
    const offset = opts?.offset ?? 0;

    return this.db
      .select(chatColumns)
      .from(brainChats)
      .where(and(...conditions))
      .orderBy(desc(brainChats.updatedAt))
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
      .insert(brainChats)
      .values({ tenantId: dto.tenantId, userId: dto.userId, projectId: dto.projectId ?? null, title })
      .returning(chatColumns);

    return chat;
  }

  async getChat(chatId: number, tenantId: number, userId: string) {
    const [chat] = await this.db
      .select(chatDetailColumns)
      .from(brainChats)
      .where(
        and(
          eq(brainChats.id, chatId),
          eq(brainChats.tenantId, tenantId),
          eq(brainChats.userId, userId),
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
      .update(brainChats)
      .set(updates)
      .where(eq(brainChats.id, chatId))
      .returning(chatColumns);

    return updated;
  }

  async archiveChat(chatId: number, tenantId: number, userId: string) {
    const existing = await this.verifyChatOwnership(chatId, tenantId, userId);
    if (!existing) return { error: 'Chat not found' as const };

    await this.db
      .update(brainChats)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(brainChats.id, chatId));

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
      .from(brainMessages)
      .where(eq(brainMessages.chatId, chatId))
      .orderBy(brainMessages.seq)
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
      .select({ maxSeq: sql<number>`COALESCE(MAX(${brainMessages.seq}), 0)` })
      .from(brainMessages)
      .where(eq(brainMessages.chatId, chatId));
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
        .insert(brainMessages)
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
      .update(brainChats)
      .set({ updatedAt: new Date() })
      .where(eq(brainChats.id, chatId));

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
        id: brainMessages.id,
        chatId: brainMessages.chatId,
        metadata: brainMessages.metadata,
      })
      .from(brainMessages)
      .where(eq(brainMessages.id, messageId));
    if (!msg) return { error: 'Message not found' as const };

    // Verify ownership of the parent chat
    const chat = await this.verifyChatOwnership(msg.chatId, tenantId, userId);
    if (!chat) return { error: 'Message not found' as const };

    // Merge feedback into existing metadata JSON
    const existing = msg.metadata ? JSON.parse(msg.metadata) : {};
    existing.feedback = feedback;

    const [updated] = await this.db
      .update(brainMessages)
      .set({ metadata: JSON.stringify(existing) })
      .where(eq(brainMessages.id, messageId))
      .returning(messageColumns);

    return updated ?? { error: 'Update failed' as const };
  }

  // -----------------------------------------------------------------------
  // Summarisation
  // -----------------------------------------------------------------------

  async summarizeChat(chatId: number, tenantId: number, userId: string, apiKey: string) {
    const chat = await this.verifyChatOwnership(chatId, tenantId, userId, {
      projectId: brainChats.projectId,
    }) as { id: number; projectId: number | null } | null;
    if (!chat) return { error: 'Chat not found' as const };

    const msgs = await this.db
      .select({ role: brainMessages.role, content: brainMessages.content })
      .from(brainMessages)
      .where(eq(brainMessages.chatId, chatId))
      .orderBy(brainMessages.seq)
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

    // Upsert chat memory (one per chat)
    await this.db
      .insert(chatMemories)
      .values({ tenantId, chatId, projectId: chat.projectId, summary })
      .onConflictDoUpdate({
        target: chatMemories.chatId,
        set: { summary, updatedAt: new Date() },
      });

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

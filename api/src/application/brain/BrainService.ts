import { eq, and, or, desc, isNull, inArray, sql } from 'drizzle-orm';
import {
  brainChats,
  brainChatMessages,
  chatMemories,
  chatMembers,
  chatSessions,
  chatMessages,
  projectMemories,
  projects,
  teams,
  agentAssignments,
  users,
  tenantMembers,
  tenantInvitations,
} from '../../infrastructure/database/schema';
import { ideProxy } from '../llm/LlmProxyService';
import { recordProxyUsage } from '../llm/usageLedger';
import { resolveWorkforceModel, WORKFORCE_MODEL_REF_PREFIX } from '../agent/agentPrompt';
import { listBuiltinTools, callBuiltinTool, CLOUD_AGENT_PLATFORM_TOOLS } from '../llm/builtinMcpService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const BRAIN_ORIGIN = 'brainstorm';
/** The canonical always-there team GROUP chat (migration 0294). Reuses the whole
 *  Brain chat stack; one per (tenant, projectId), projectId NULL = tenant-wide. */
const TEAM_ORIGIN = 'team';
/** Origins reachable through the shared chat access/message endpoints. Team chats
 *  ride the exact same read/post path as brainstorm chats (only owner-only ADMIN —
 *  rename/archive/lock — stays brainstorm-only via {@link verifyChatOwnership}). */
const ACCESSIBLE_ORIGINS = [BRAIN_ORIGIN, TEAM_ORIGIN] as const;

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
  /** LOCK toggle (owner only): 'shared' = teammate-visible, 'locked' = private. */
  visibility?: 'shared' | 'locked';
}

export interface AppendMessagesDto {
  messages: Array<{ role: string; content: string; metadata?: string }>;
}

/** Which team chat to resolve. A project team chat (`projectId`), a named workforce
 *  team's chat (`teamId`), or — both omitted — the tenant-wide "broader team" chat. */
export interface TeamChatScope {
  projectId?: number | null;
  teamId?: number | null;
}

// ---------------------------------------------------------------------------
// Return shapes (presentation-agnostic) — unified project chats, origin=brainstorm
// ---------------------------------------------------------------------------

const chatColumns = {
  id: brainChats.id,
  projectId: brainChats.projectId,
  origin: brainChats.origin,
  title: brainChats.title,
  ownerId: brainChats.userId,
  visibility: brainChats.visibility,
  createdAt: brainChats.createdAt,
  updatedAt: brainChats.updatedAt,
} as const;

const chatDetailColumns = {
  ...chatColumns,
  isArchived: brainChats.isArchived,
} as const;

const messageColumns = {
  id: brainChatMessages.id,
  role: brainChatMessages.role,
  content: brainChatMessages.content,
  metadata: brainChatMessages.metadata,
  seq: brainChatMessages.seq,
  createdAt: brainChatMessages.createdAt,
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
          eq(brainChats.origin, BRAIN_ORIGIN),
        ),
      )
      .limit(1);
    return chat ?? null;
  }

  /**
   * Shared-access guard (migration 0288). Brain chats are global to their
   * project+tenant, so access depends on the chat's VISIBILITY:
   *   • 'shared' (default) → any teammate in the tenant may open/read/post; the
   *     first time a non-owner contributes they are auto-recorded as a member so
   *     the roster reflects the chat's live audience.
   *   • 'locked'           → only the OWNER or an active member may access.
   * Before denying a locked chat it lazily converts any pending email-invite for
   * this user, so a freshly-invited person can deep-link straight in.
   *
   * Owner-only admin (rename/archive/invite/remove/lock) keeps using
   * {@link verifyChatOwnership}.
   */
  private async canAccessChat(
    chatId: number,
    tenantId: number,
    userId: string,
    selectExtra?: Record<string, unknown>,
  ) {
    const columns = {
      id: brainChats.id,
      ownerId: brainChats.userId,
      visibility: brainChats.visibility,
      ...(selectExtra ?? {}),
    };
    const [chat] = await this.db
      .select(columns as typeof columns & { id: typeof brainChats.id })
      .from(brainChats)
      .where(and(
        eq(brainChats.id, chatId),
        eq(brainChats.tenantId, tenantId),
        inArray(brainChats.origin, ACCESSIBLE_ORIGINS as unknown as string[]),
      ))
      .limit(1);
    if (!chat) return null;

    const c = chat as unknown as { ownerId: string | null; visibility: string };
    if (c.ownerId === userId) return chat;           // owner
    if (c.visibility !== 'locked') return chat;       // shared → any teammate

    // Locked: owner or active member only.
    const isMember = async () => {
      const [m] = await this.db
        .select({ id: chatMembers.id })
        .from(chatMembers)
        .where(and(
          eq(chatMembers.chatId, chatId),
          eq(chatMembers.tenantId, tenantId),
          eq(chatMembers.userId, userId),
          eq(chatMembers.status, 'active'),
        ))
        .limit(1);
      return !!m;
    };
    if (await isMember()) return chat;
    // Maybe a pending invite addressed this user's email — convert then re-check.
    await this.syncPendingMemberships(tenantId, userId);
    if (await isMember()) return chat;
    return null;
  }

  /** Record a contributing non-owner as an active member (the chat's audience),
   *  idempotent. Owners are skipped. Best-effort — a race just no-ops on the
   *  unique (chat_id, user_id) index. */
  private async ensureMembership(chatId: number, tenantId: number, userId: string, ownerId: string | null): Promise<void> {
    if (!userId || userId === ownerId) return;
    try {
      const [existing] = await this.db
        .select({ id: chatMembers.id })
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
        .limit(1);
      if (existing) return;
      await this.db.insert(chatMembers)
        .values({ chatId, tenantId, userId, status: 'active', role: 'participant' });
    } catch {
      /* audience tracking is non-critical — never fail a post over it */
    }
  }

  /** The user's email (for pending-invite matching). */
  private async getUserEmail(userId: string): Promise<string | null> {
    const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.email?.toLowerCase() ?? null;
  }

  /**
   * Activate any pending chat-member invites whose `invited_email` matches this
   * user's address — the auto-conversion that mirrors tenant_invitations. Single
   * bounded UPDATE keyed on the indexed lower(invited_email); a no-op (0 rows) when
   * the user has no pending invites. Returns the chat ids that just converted.
   */
  private async syncPendingMemberships(tenantId: number, userId: string): Promise<number[]> {
    const email = await this.getUserEmail(userId);
    if (!email) return [];
    const rows = await this.db
      .update(chatMembers)
      .set({ userId, status: 'active', invitedEmail: null, updatedAt: new Date() })
      .where(and(
        eq(chatMembers.tenantId, tenantId),
        isNull(chatMembers.userId),
        eq(chatMembers.status, 'pending'),
        sql`lower(${chatMembers.invitedEmail}) = ${email}`,
      ))
      .returning({ chatId: chatMembers.chatId });
    return rows.map((r) => r.chatId);
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

  /** Record a Brain summarization call in the usage ledger [1310] (best-effort,
   *  fire-and-forget; no-ops without usage). These non-streaming background calls
   *  were previously invisible to billing. The apiKey-only env is enough for the
   *  usage row; pricing lookup is best-effort. */
  private recordUsage(apiKey: string, tenantId: number, useCase: string, result: Parameters<typeof recordProxyUsage>[2]['result']): void {
    void recordProxyUsage(this.db, { OPENROUTER_API_KEY: apiKey } as Env, { tenantId, useCase, result });
  }

  // -----------------------------------------------------------------------
  // Chat CRUD
  // -----------------------------------------------------------------------

  async listChats(
    tenantId: number,
    userId: string,
    opts?: { projectId?: string; limit?: number; offset?: number },
  ) {
    // Activate any pending email-invites for this user, then list chats they OWN
    // or are an active MEMBER of (shared access, migration 0288).
    await this.syncPendingMemberships(tenantId, userId);
    const memberRows = await this.db
      .select({ chatId: chatMembers.chatId })
      .from(chatMembers)
      .where(and(
        eq(chatMembers.tenantId, tenantId),
        eq(chatMembers.userId, userId),
        eq(chatMembers.status, 'active'),
      ));
    const memberChatIds = memberRows.map((r) => r.chatId);

    // Visible chats: ones you OWN, ones you're an active member of, and every
    // SHARED chat in this tenant (chats are global to project+tenant). Locked chats
    // only surface to their owner/members.
    const visible = memberChatIds.length > 0
      ? or(eq(brainChats.userId, userId), eq(brainChats.visibility, 'shared'), inArray(brainChats.id, memberChatIds))!
      : or(eq(brainChats.userId, userId), eq(brainChats.visibility, 'shared'))!;
    const conditions = [
      eq(brainChats.tenantId, tenantId),
      visible,
      eq(brainChats.origin, BRAIN_ORIGIN),
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

    const rows = await this.db
      .select(chatColumns)
      .from(brainChats)
      .where(and(...conditions))
      .orderBy(desc(brainChats.updatedAt))
      .limit(limit)
      .offset(offset);

    // Attach each chat's invited participants (multi-party chat) so a surface can
    // show a participant roster / avatars on the row. ONE extra grouped query over
    // the just-returned chat ids (no N+1), scoped to this user's chats. Additive
    // and guarded: participants are a nice-to-have, so a failure here must never
    // break the chat list itself.
    return this.attachParticipants(tenantId, rows);
  }

  /** Fold `participants: {ref, kind, name?}[]` onto chat rows via one grouped query. */
  private async attachParticipants<T extends { id: number }>(
    tenantId: number,
    rows: T[],
  ): Promise<Array<T & { participants: Array<{ ref: string; kind: string; name?: string }> }>> {
    const byChat = new Map<number, Array<{ ref: string; kind: string; name?: string }>>();
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      try {
        const asg = await this.db
          .select({
            scopeId: agentAssignments.scopeId,
            agentRef: agentAssignments.agentRef,
            agentKind: agentAssignments.agentKind,
          })
          .from(agentAssignments)
          .where(and(
            eq(agentAssignments.tenantId, tenantId),
            eq(agentAssignments.scope, 'chat'),
            inArray(agentAssignments.scopeId, ids.map(String)),
          ));
        for (const a of asg) {
          const cid = Number(a.scopeId);
          if (!Number.isNaN(cid)) {
            const list = byChat.get(cid) ?? [];
            list.push({ ref: a.agentRef, kind: 'agent' });
            byChat.set(cid, list);
          }
        }
        // Human members (migration 0288) join the same roster with kind='human',
        // ref = their user id, name = their display name (so a non-webview surface
        // like the native SESSIONS tree can label them without a second lookup).
        const mem = await this.db
          .select({ chatId: chatMembers.chatId, userId: chatMembers.userId, name: users.displayName, email: users.email })
          .from(chatMembers)
          .leftJoin(users, eq(users.id, chatMembers.userId))
          .where(and(
            eq(chatMembers.tenantId, tenantId),
            eq(chatMembers.status, 'active'),
            inArray(chatMembers.chatId, ids),
          ));
        for (const m of mem) {
          if (!m.userId) continue;
          const list = byChat.get(m.chatId) ?? [];
          list.push({ ref: m.userId, kind: 'human', name: m.name || m.email || undefined });
          byChat.set(m.chatId, list);
        }
      } catch {
        /* participants are non-critical — the chat list must survive their absence */
      }
    }
    return rows.map((r) => ({ ...r, participants: byChat.get(r.id) ?? [] }));
  }

  async createChat(dto: CreateChatDto) {
    const title = dto.title?.trim() || 'New chat';

    if (dto.projectId != null) {
      const proj = await this.verifyProjectInTenant(dto.projectId, dto.tenantId);
      if (!proj) return { error: 'Project not found in tenant' as const };
    }

    const [chat] = await this.db
      .insert(brainChats)
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

  // -----------------------------------------------------------------------
  // Team Chat — the canonical, always-there group chat (migration 0294)
  // -----------------------------------------------------------------------

  /** Resolve the ONE team chat for a scope, creating it on first access. Scope is
   *  a project (`projectId`), a named workforce team (`teamId`), or — when both are
   *  null — the tenant-wide "broader team". Race-safe: the unique `uq_team_chat_scope`
   *  index means a concurrent create just re-selects the winner. `userId` may be null
   *  (an unattended agent resolving it). */
  private async findTeamChat(tenantId: number, scope: TeamChatScope) {
    const [row] = await this.db
      .select(chatDetailColumns)
      .from(brainChats)
      .where(and(
        eq(brainChats.tenantId, tenantId),
        eq(brainChats.origin, TEAM_ORIGIN),
        eq(brainChats.isArchived, false),
        scope.projectId != null ? eq(brainChats.projectId, scope.projectId) : isNull(brainChats.projectId),
        scope.teamId != null ? eq(brainChats.teamId, scope.teamId) : isNull(brainChats.teamId),
      ))
      .limit(1);
    return row ?? null;
  }

  private async verifyTeamInTenant(teamId: number, tenantId: number) {
    const [team] = await this.db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
      .limit(1);
    return team ?? null;
  }

  async getOrCreateTeamChat(tenantId: number, userId: string | null, scope: TeamChatScope = {}) {
    const projectId = scope.projectId ?? null;
    const teamId = scope.teamId ?? null;
    let title = 'Team Chat';
    if (projectId != null) {
      const proj = await this.verifyProjectInTenant(projectId, tenantId);
      if (!proj) return { error: 'Project not found in tenant' as const };
      title = `${proj.name} — Team`;
    } else if (teamId != null) {
      const team = await this.verifyTeamInTenant(teamId, tenantId);
      if (!team) return { error: 'Team not found in tenant' as const };
      title = `${team.name}`;
    }

    let chat = await this.findTeamChat(tenantId, { projectId, teamId });
    if (!chat) {
      try {
        const [created] = await this.db
          .insert(brainChats)
          .values({ tenantId, userId: userId ?? null, origin: TEAM_ORIGIN, projectId, teamId, title, visibility: 'shared' })
          .returning(chatDetailColumns);
        chat = created ?? null;
      } catch {
        // Lost the create race (unique index) — the winner is now selectable.
        chat = await this.findTeamChat(tenantId, { projectId, teamId });
      }
    }
    if (!chat) return { error: 'Chat not found' as const };

    const { ownerId, ...rest } = chat as unknown as Record<string, unknown> & { ownerId: string | null };
    return {
      ...rest,
      id: (chat as unknown as { id: number }).id,
      isOwner: ownerId != null && ownerId === userId,
      visibility: (rest as { visibility?: string }).visibility ?? 'shared',
      isTeamChat: true as const,
    };
  }

  /** Read the recent transcript of a team chat (agent-facing — server picks the
   *  tenant's own canonical chat, so there is no cross-tenant id to guard). */
  async readTeamChat(tenantId: number, scope: TeamChatScope, limit = 30) {
    const resolved = await this.getOrCreateTeamChat(tenantId, null, scope);
    if ('error' in resolved) return resolved;
    const msgs = await this.db
      .select(messageColumns)
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, resolved.id as number))
      .orderBy(desc(brainChatMessages.seq))
      .limit(Math.min(Math.max(1, limit), 100));
    return { chatId: resolved.id, messages: msgs.reverse() };
  }

  /** Post a message INTO a team chat as an agent (agent-facing — no human userId
   *  gate; the server resolves the tenant's own canonical chat). Attribution rides
   *  metadata.authoredBy, mirroring {@link agentReply}. */
  async postToTeamChat(
    tenantId: number,
    scope: TeamChatScope,
    content: string,
    opts?: { fromName?: string; fromRef?: string },
  ) {
    const text = content?.trim();
    if (!text) return { error: 'content is required' as const };
    const resolved = await this.getOrCreateTeamChat(tenantId, null, scope);
    if ('error' in resolved) return resolved;
    const metadata = JSON.stringify({
      via: 'team_chat.post',
      authoredBy: { kind: 'agent', ref: opts?.fromRef ?? 'agent', ...(opts?.fromName ? { name: opts.fromName } : {}) },
    });
    const [msg] = await this.appendRaw(resolved.id as number, [{ role: 'assistant', content: text, metadata }]);
    return { chatId: resolved.id, message: msg ?? null };
  }

  async getChat(chatId: number, tenantId: number, userId: string) {
    // Owner, member, or (shared) any teammate may open the chat — migration 0288.
    const chat = await this.canAccessChat(chatId, tenantId, userId, {
      projectId: brainChats.projectId,
      origin: brainChats.origin,
      title: brainChats.title,
      createdAt: brainChats.createdAt,
      updatedAt: brainChats.updatedAt,
      isArchived: brainChats.isArchived,
    });
    if (!chat) return null;
    // Surface ownership + lock state so the client can gate owner-only controls.
    const { ownerId, ...rest } = chat as unknown as Record<string, unknown> & { ownerId: string | null };
    return { ...rest, isOwner: ownerId === userId, visibility: (rest as { visibility?: string }).visibility ?? 'shared' };
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
    if (dto.visibility === 'shared' || dto.visibility === 'locked') updates.visibility = dto.visibility;

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
    const chat = await this.canAccessChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };

    const msgs = await this.db
      .select(messageColumns)
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(brainChatMessages.seq)
      .limit(Math.min(limit, 500));

    return msgs;
  }

  async appendMessages(
    chatId: number,
    tenantId: number,
    userId: string,
    dto: AppendMessagesDto,
  ) {
    // Owner, member, or (for shared chats) any teammate may post — migration 0288.
    const chat = await this.canAccessChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };

    if (!Array.isArray(dto.messages) || dto.messages.length === 0) {
      return { error: 'messages array is required' as const };
    }

    // Contributing to a shared chat joins you to it (records the live audience).
    await this.ensureMembership(chatId, tenantId, userId, (chat as unknown as { ownerId: string | null }).ownerId);

    return this.appendRaw(chatId, dto.messages);
  }

  /** Append messages to a chat (seq-managed insert + touch), NO access check —
   *  callers must have already verified access. Shared by {@link appendMessages}
   *  and {@link agentReply} so the write path lives once. */
  private async appendRaw(chatId: number, messages: Array<{ role: string; content: string; metadata?: string | null }>) {
    const [maxRow] = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${brainChatMessages.seq}), 0)` })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId));
    let seq = maxRow?.maxSeq ?? 0;

    const inserted: Array<{
      id: number;
      role: string;
      content: string;
      metadata: string | null;
      seq: number;
      createdAt: Date;
    }> = [];

    for (const msg of messages) {
      if (!msg.role || typeof msg.content !== 'string') continue;
      seq += 1;
      const [row] = await this.db
        .insert(brainChatMessages)
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
  // Addressed-agent reply — a chat-scoped run that answers AS an invited agent
  // -----------------------------------------------------------------------

  /**
   * Produce a reply AS an invited agent participant and post it as an assistant
   * turn attributed to that agent (metadata `authoredBy: {kind:'agent', ref, name}`,
   * mirroring the `addressedTo` convention). This is the "next layer" over directed
   * messages: `@agent`-ing a participant used to only post the user's turn; now the
   * addressed agent actually answers, grounded on its own persona + ingested
   * knowledge (via the shared {@link resolveWorkforceModel}) and on the transcript.
   *
   * The agent runs a BOUNDED server-side tool loop over the curated, non-destructive
   * platform tools (`CLOUD_AGENT_PLATFORM_TOOLS` — projects/tasks/specs/OKRs/knowledge
   * reads + safe writes, NO deletes or control-plane), executed via `callBuiltinTool`
   * with the TRIGGERING USER's role/token so the agent can never exceed the human's
   * own permissions. So a teammate agent can actually DO things (create a follow-up
   * task, update an OKR, read the board) when addressed — not just chat. Tool errors
   * are fed back as tool results so the agent can recover or explain. File-editing is
   * still the BRAIN/host loop's job; this is the platform-tool layer.
   */
  async agentReply(
    chatId: number,
    tenantId: number,
    userId: string,
    input: { agentRef: string; agentName?: string },
    env: Env,
    opts?: { role?: string; authToken?: string | null; executionCtx?: ExecutionContext },
  ) {
    const chat = await this.canAccessChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) return { error: 'LLM not configured' as const };

    const msgs = await this.db
      .select({ role: brainChatMessages.role, content: brainChatMessages.content, metadata: brainChatMessages.metadata })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(brainChatMessages.seq)
      .limit(80);
    if (msgs.length === 0) return { error: 'Nothing to reply to' as const };

    // Persona + own-knowledge grounding for a workforce agent (ref = ide_agents.id).
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
    const resolved = await resolveWorkforceModel(env, WORKFORCE_MODEL_REF_PREFIX + input.agentRef, lastUser).catch(() => null);
    const agentName = input.agentName?.trim() || 'the agent';
    const persona = resolved?.directives
      ? `${resolved.directives}\n\n`
      : `You are ${agentName}, a member of this team's chat.\n\n`;

    const authorName = (label: string | null): string => {
      if (!label) return 'BuilderForce';
      try {
        const a = (JSON.parse(label) as { authoredBy?: { name?: string } }).authoredBy;
        return a?.name || 'BuilderForce';
      } catch { return 'BuilderForce'; }
    };
    const transcript = msgs
      .map((m) => `${m.role === 'user' ? 'User' : authorName(m.metadata)}: ${m.content}`)
      .join('\n\n');

    const projectHint = (chat as unknown as { projectId?: number | null }).projectId ?? null;
    const systemPrompt = [
      persona,
      `You have been addressed directly in this multi-party team chat${projectHint != null ? ` (project #${projectHint})` : ''}. `,
      `Reply AS ${agentName} — first person, concise, helpful, no preamble and no "${agentName}:" label. `,
      `You may use the provided tools to read or update the team's work (projects, tasks, specs, OKRs, knowledge) when it helps answer or act on the request. After using tools, summarise what you found or did.`,
    ].join('');

    // Curated, non-destructive platform tools (same allowlist an autonomous cloud
    // agent gets). Advertised name → tool id map for executing the model's calls.
    const toolEntries = listBuiltinTools().filter((t) => CLOUD_AGENT_PLATFORM_TOOLS.includes(t.tool));
    const nameToTool = new Map(toolEntries.map((t) => [t.name, t.tool]));
    const tools = toolEntries.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

    const convo: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Conversation so far:\n\n${transcript}` },
    ];

    const service = this.buildLlmService(apiKey);
    const MAX_ITERS = 6;
    let text = '';
    for (let i = 0; i < MAX_ITERS; i++) {
      const result = await service.complete({
        model: resolved?.baseModel ?? undefined,
        messages: convo as never,
        tools,
        temperature: 0.4,
        max_tokens: 1200,
      });
      this.recordUsage(apiKey, tenantId, 'brain_agent_reply', result);
      const message = (result.response as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments?: string } }> } }> } | undefined)
        ?.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];

      if (toolCalls.length === 0) {
        text = message?.content?.trim() ?? '';
        break;
      }

      // Echo the assistant tool-call turn, then execute each call and feed results.
      convo.push({ role: 'assistant', content: message?.content ?? '', tool_calls: toolCalls });
      for (const tc of toolCalls) {
        const toolId = nameToTool.get(tc.function.name) ?? tc.function.name;
        let out: unknown;
        try {
          const argObj = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          out = await callBuiltinTool(this.db, {
            tenantId, tool: toolId, arguments: argObj, env,
            userId, role: opts?.role as never, authToken: opts?.authToken, executionCtx: opts?.executionCtx,
          });
        } catch (e) {
          out = { error: e instanceof Error ? e.message : 'tool call failed' };
        }
        convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out ?? null).slice(0, 8000) });
      }
      // On the last allowed iteration, ask once more WITHOUT tools for a final answer.
      if (i === MAX_ITERS - 1) {
        const finalResult = await service.complete({
          model: resolved?.baseModel ?? undefined,
          messages: convo as never,
          temperature: 0.4,
          max_tokens: 1000,
        });
        this.recordUsage(apiKey, tenantId, 'brain_agent_reply', finalResult);
        text = (finalResult.response as { choices?: Array<{ message?: { content?: string } }> } | undefined)
          ?.choices?.[0]?.message?.content?.trim() ?? '';
      }
    }

    if (!text) return { error: 'Agent returned an empty reply' as const };

    const metadata = JSON.stringify({ authoredBy: { kind: 'agent', ref: input.agentRef, name: agentName } });
    const [posted] = await this.appendRaw(chatId, [{ role: 'assistant', content: text, metadata }]);
    return posted ?? { error: 'Failed to post reply' as const };
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
        id: brainChatMessages.id,
        chatId: brainChatMessages.chatId,
        metadata: brainChatMessages.metadata,
      })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.id, messageId));
    if (!msg) return { error: 'Message not found' as const };

    // Verify access to the parent chat (owner or member).
    const chat = await this.canAccessChat(msg.chatId, tenantId, userId);
    if (!chat) return { error: 'Message not found' as const };

    // Merge feedback into existing metadata JSON
    const existing = msg.metadata ? JSON.parse(msg.metadata) : {};
    existing.feedback = feedback;

    const [updated] = await this.db
      .update(brainChatMessages)
      .set({ metadata: JSON.stringify(existing) })
      .where(eq(brainChatMessages.id, messageId))
      .returning(messageColumns);

    return updated ?? { error: 'Update failed' as const };
  }

  // -----------------------------------------------------------------------
  // Human members (shared access, migration 0288)
  // -----------------------------------------------------------------------

  /** Active human members of a chat (owner or any member may read the roster). */
  async listMembers(chatId: number, tenantId: number, userId: string) {
    const chat = await this.canAccessChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    const rows = await this.db
      .select({
        id: chatMembers.id,
        userId: chatMembers.userId,
        email: chatMembers.invitedEmail,
        status: chatMembers.status,
        name: users.displayName,
        userEmail: users.email,
        role: chatMembers.role,
      })
      .from(chatMembers)
      .leftJoin(users, eq(users.id, chatMembers.userId))
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.tenantId, tenantId)))
      .orderBy(chatMembers.createdAt);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      status: r.status,
      role: r.role,
      email: (r.userEmail ?? r.email ?? '').toLowerCase(),
      name: r.name || r.userEmail || r.email || 'Invited',
    }));
  }

  /**
   * Invite a human to a chat by email (owner only). If the email belongs to an
   * existing member of this tenant the invite is ACTIVE immediately (they get
   * access + a notification); otherwise a PENDING row is written that converts on
   * their next access. Idempotent per (chat, user) / (chat, email). Returns the
   * resolution the route needs to fire the in-app + email notification.
   */
  async inviteHuman(
    chatId: number,
    tenantId: number,
    userId: string,
    input: { email: string },
  ): Promise<
    | { error: string }
    | { status: 'active' | 'pending'; memberUserId: string | null; email: string; chatTitle: string; already: boolean }
  > {
    const chat = await this.verifyChatOwnership(chatId, tenantId, userId, { title: brainChats.title }) as
      | { id: number; title: string }
      | null;
    if (!chat) return { error: 'Chat not found' };
    const email = input.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A valid email is required' };

    // Resolve the email to an existing active member of THIS tenant (so their
    // tenant-scoped token can actually reach the chat).
    const [existingUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(tenantMembers, and(eq(tenantMembers.userId, users.id), eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)))
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existingUser) {
      if (existingUser.id === userId) return { error: 'You already own this chat' };
      const [dup] = await this.db.select({ id: chatMembers.id })
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, existingUser.id)))
        .limit(1);
      if (!dup) {
        await this.db.insert(chatMembers).values({
          chatId, tenantId, userId: existingUser.id, status: 'active', invitedBy: userId,
        });
      }
      return { status: 'active', memberUserId: existingUser.id, email, chatTitle: chat.title, already: !!dup };
    }

    // Cold invite — pending row keyed on the email, converts on first access.
    const [dup] = await this.db.select({ id: chatMembers.id })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), sql`lower(${chatMembers.invitedEmail}) = ${email}`))
      .limit(1);
    if (!dup) {
      await this.db.insert(chatMembers).values({
        chatId, tenantId, invitedEmail: email, status: 'pending', invitedBy: userId,
      });
      // Also drop a pending TENANT invitation so the cold invitee actually gets a
      // tenant account on signup (the existing tenant-invite auto-conversion adds
      // them to tenant_members). Once in the tenant, syncPendingMemberships promotes
      // their chat membership to active — completing the join with no extra step.
      const [tinv] = await this.db.select({ id: tenantInvitations.id })
        .from(tenantInvitations)
        .where(and(eq(tenantInvitations.tenantId, tenantId), sql`lower(${tenantInvitations.email}) = ${email}`, eq(tenantInvitations.status, 'pending')))
        .limit(1);
      if (!tinv) {
        await this.db.insert(tenantInvitations).values({
          tenantId, email, status: 'pending', invitedByUserId: userId,
        }).onConflictDoNothing();
      }
    }
    return { status: 'pending', memberUserId: null, email, chatTitle: chat.title, already: !!dup };
  }

  /** Remove a human member from a chat (owner only). */
  async removeMember(chatId: number, tenantId: number, userId: string, memberId: number) {
    const chat = await this.verifyChatOwnership(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    const rows = await this.db
      .delete(chatMembers)
      .where(and(eq(chatMembers.id, memberId), eq(chatMembers.chatId, chatId), eq(chatMembers.tenantId, tenantId)))
      .returning({ id: chatMembers.id });
    return { removed: rows.length > 0 };
  }

  // -----------------------------------------------------------------------
  // Summarisation
  // -----------------------------------------------------------------------

  async summarizeChat(chatId: number, tenantId: number, userId: string, apiKey: string) {
    const chat = await this.canAccessChat(chatId, tenantId, userId, {
      projectId: brainChats.projectId,
    }) as { id: number; projectId: number | null } | null;
    if (!chat) return { error: 'Chat not found' as const };

    const msgs = await this.db
      .select({ role: brainChatMessages.role, content: brainChatMessages.content })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(brainChatMessages.seq)
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
    this.recordUsage(apiKey, tenantId, 'brain_summary', result);

    const response = result.response as { choices?: Array<{ message?: { content?: string } }> } | undefined;
    const summary = response?.choices?.[0]?.message?.content?.trim() ?? '';

    if (!summary) {
      return { summary: null, reason: 'LLM returned empty response' };
    }

    // Store summary on the unified chat row (Brain Storm chats use brain_chats)
    await this.db
      .update(brainChats)
      .set({ summary, updatedAt: new Date() })
      .where(eq(brainChats.id, chatId));

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
    this.recordUsage(apiKey, tenantId, 'brain_project_memory', result);

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
  // AgentHost session summarisation — bridges agentHost chat history into brain memory
  // -----------------------------------------------------------------------

  async summarizeAgentHostSession(sessionId: number, tenantId: number, apiKey: string) {
    // Verify session belongs to tenant
    const [session] = await this.db
      .select({
        id: chatSessions.id,
        projectId: chatSessions.projectId,
        agentHostId: chatSessions.agentHostId,
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
      'You are a summarization assistant. Compress the following agentHost coding session into a concise memory.',
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
    this.recordUsage(apiKey, tenantId, 'brain_summary', result);

    const response = result.response as { choices?: Array<{ message?: { content?: string } }> } | undefined;
    const summary = response?.choices?.[0]?.message?.content?.trim() ?? '';

    if (!summary) {
      return { summary: null, reason: 'LLM returned empty response' };
    }

    // Store in chatMemories linked via agentHostSessionId for project memory consolidation
    await this.db
      .insert(chatMemories)
      .values({
        tenantId,
        agentHostSessionId: sessionId,
        projectId: session.projectId,
        summary,
      })
      .onConflictDoUpdate({
        target: chatMemories.agentHostSessionId,
        set: { summary, projectId: session.projectId, updatedAt: new Date() },
      });

    return { summary, projectId: session.projectId };
  }
}

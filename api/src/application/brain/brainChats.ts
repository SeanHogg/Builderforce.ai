/**
 * Brain chat CRUD use cases — list (with participant roster), create, open, update,
 * archive. Split out of `BrainService.ts`; the facade delegates here.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { eq, and, or, desc, isNull, inArray } from 'drizzle-orm';
import { brainChats, chatMembers, agentAssignments, users } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { BRAIN_ORIGIN } from './chatAccess';
import { normalizeChatMode, resolveChatMode, NEW_CHAT_MODE } from './chatMode';
import { normalizeChatTitle } from './chatTitle';
import { chatColumns, normalizeCapability, type CreateChatDto, type UpdateChatDto } from './brainChatShapes';
import { canAccessChat, syncPendingMemberships, verifyChatOwnership, verifyProjectInTenant } from './brainChatGuards';
import type { Db } from '../../infrastructure/database/connection';

export async function listChats(
  db: Db,
  tenantId: number,
  userId: string,
  opts?: { projectId?: string; limit?: number; offset?: number },
) {
  // Activate any pending email-invites for this user, then list chats they OWN
  // or are an active MEMBER of (shared access, migration 0288).
  await syncPendingMemberships(db, tenantId, userId);
  // The membership set is a SUBQUERY of the chat read rather than a round trip of
  // its own; it runs after the sync above, so just-activated invites are in it.
  const memberChatIds = db
    .select({ chatId: chatMembers.chatId })
    .from(chatMembers)
    .where(and(
      eq(chatMembers.tenantId, tenantId),
      eq(chatMembers.userId, userId),
      eq(chatMembers.status, 'active'),
    ));

  // Visible chats: ones you OWN, ones you're an active member of, and every
  // SHARED chat in this tenant (chats are global to project+tenant). Locked chats
  // only surface to their owner/members.
  const visible = or(eq(brainChats.userId, userId), eq(brainChats.visibility, 'shared'), inArray(brainChats.id, memberChatIds))!;
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

  const rows = await db
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
  return attachParticipants(db, tenantId, rows);
}

/** Fold `participants: {ref, kind, name?}[]` onto chat rows via one grouped query. */
export async function attachParticipants<T extends { id: number }>(
  db: Db,
  tenantId: number,
  rows: T[],
): Promise<Array<T & { participants: Array<{ ref: string; kind: string; name?: string }> }>> {
  const byChat = new Map<number, Array<{ ref: string; kind: string; name?: string }>>();
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    // The agent and human rosters are independent reads, so they run together.
    // Settled separately to keep the old failure shape: a failed agent read leaves
    // the roster empty, a failed member read still keeps the agents.
    const [asg, mem] = await Promise.allSettled([
      db
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
        )),
      // Human members (migration 0288) join the same roster with kind='human',
      // ref = their user id, name = their display name (so a non-webview surface
      // like the native SESSIONS tree can label them without a second lookup).
      db
        .select({ chatId: chatMembers.chatId, userId: chatMembers.userId, name: users.displayName, email: users.email })
        .from(chatMembers)
        .leftJoin(users, eq(users.id, chatMembers.userId))
        .where(and(
          eq(chatMembers.tenantId, tenantId),
          eq(chatMembers.status, 'active'),
          inArray(chatMembers.chatId, ids),
        )),
    ]);
    /* participants are non-critical — the chat list must survive their absence */
    if (asg.status === 'rejected') {
      reportCaughtError(asg.reason, { source: "application/brain/BrainService.ts", operation: "attachParticipants" });
    } else {
      for (const a of asg.value) {
        const cid = Number(a.scopeId);
        if (!Number.isNaN(cid)) {
          const list = byChat.get(cid) ?? [];
          list.push({ ref: a.agentRef, kind: 'agent' });
          byChat.set(cid, list);
        }
      }
      if (mem.status === 'rejected') {
        reportCaughtError(mem.reason, { source: "application/brain/BrainService.ts", operation: "attachParticipants" });
      } else {
        for (const m of mem.value) {
          if (!m.userId) continue;
          const list = byChat.get(m.chatId) ?? [];
          list.push({ ref: m.userId, kind: 'human', name: m.name || m.email || undefined });
          byChat.set(m.chatId, list);
        }
      }
    }
  }
  return rows.map((r) => ({ ...r, participants: byChat.get(r.id) ?? [] }));
}

export async function createChat(db: Db, dto: CreateChatDto) {
  const title = normalizeChatTitle(dto.title);

  if (dto.projectId != null) {
    const proj = await verifyProjectInTenant(db, dto.projectId, dto.tenantId);
    if (!proj) return { error: 'Project not found in tenant' as const };
  }

  const [chat] = await db
    .insert(brainChats)
    .values({
      tenantId: dto.tenantId,
      userId: dto.userId,
      origin: BRAIN_ORIGIN,
      projectId: dto.projectId ?? null,
      title,
      capability: normalizeCapability(dto.capability),
      mode: normalizeChatMode(dto.mode) ?? NEW_CHAT_MODE,
    })
    .returning(chatColumns);

  return chat;
}

export async function getChat(db: Db, chatId: number, tenantId: number, userId: string) {
  // Owner, member, or (shared) any teammate may open the chat — migration 0288.
  const chat = await canAccessChat(db, chatId, tenantId, userId, {
    projectId: brainChats.projectId,
    origin: brainChats.origin,
    title: brainChats.title,
    capability: brainChats.capability,
    memoryEnabled: brainChats.memoryEnabled,
    createdAt: brainChats.createdAt,
    updatedAt: brainChats.updatedAt,
    isArchived: brainChats.isArchived,
  });
  if (!chat) return null;
  // Surface ownership + lock state so the client can gate owner-only controls.
  const { ownerId, ...rest } = chat as unknown as Record<string, unknown> & { ownerId: string | null };
  return { ...rest, isOwner: ownerId === userId, visibility: (rest as { visibility?: string }).visibility ?? 'shared' };
}

export async function updateChat(
  db: Db,
  chatId: number,
  tenantId: number,
  userId: string,
  dto: UpdateChatDto,
  options: { isWorkspaceAdmin?: boolean } = {},
) {
  // `mode` is read alongside the ownership check so the caller can tell an actual
  // mode SWITCH from a PATCH that merely restated the current one — the audit row is
  // about the moment authority changed hands, and a no-op must not manufacture one.
  const existing = await verifyChatOwnership(db, chatId, tenantId, userId, {
    mode: brainChats.mode,
  }, options);
  if (!existing) return { error: 'Chat not found' as const };

  if (dto.projectId != null) {
    const proj = await verifyProjectInTenant(db, dto.projectId, tenantId);
    if (!proj) return { error: 'Project not found in tenant' as const };
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (dto.title !== undefined) updates.title = normalizeChatTitle(dto.title);
  if (dto.projectId !== undefined) updates.projectId = dto.projectId;
  if (dto.visibility === 'shared' || dto.visibility === 'locked') updates.visibility = dto.visibility;
  if (dto.capability !== undefined) updates.capability = normalizeCapability(dto.capability);
  if (typeof dto.memoryEnabled === 'boolean') updates.memoryEnabled = dto.memoryEnabled;
  // An unrecognised mode is IGNORED rather than coerced: coercing would quietly
  // demote a running execution back to a conversation (and strip its dispatch
  // authority) because a stale client sent a value this build does not know.
  const nextMode = normalizeChatMode(dto.mode);
  if (nextMode) updates.mode = nextMode;

  const [updated] = await db
    .update(brainChats)
    .set(updates)
    .where(scopedToTenant(brainChats, tenantId, eq(brainChats.id, chatId)))
    .returning(chatColumns);

  // `modeChangedTo` is transient provenance for the CALLER (the route writes the audit
  // row — it owns `env` and the waitUntil budget), never a persisted column. Null when
  // the mode was not touched or the PATCH restated the value it already had.
  const previousMode = resolveChatMode(existing as { origin?: string | null; mode?: string | null });
  const modeChangedTo = nextMode && nextMode !== previousMode ? nextMode : null;
  return { ...updated, modeChangedTo };
}

export async function archiveChat(db: Db, chatId: number, tenantId: number, userId: string, options: { isWorkspaceAdmin?: boolean } = {}) {
  const existing = await verifyChatOwnership(db, chatId, tenantId, userId, undefined, options);
  if (!existing) return { error: 'Chat not found' as const };

  await db
    .update(brainChats)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(scopedToTenant(brainChats, tenantId, eq(brainChats.id, chatId)));

  return { ok: true };
}

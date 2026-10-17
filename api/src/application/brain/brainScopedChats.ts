/**
 * The always-there SINGLETON chats — the team chat (0294) and the manager chat
 * (0376) — resolved by get-or-create per (tenant, origin, scope), plus the
 * agent-facing read/post on a team chat. Split out of `BrainService.ts`.
 */

import { eq, and, desc, isNull } from 'drizzle-orm';
import { brainChats, brainChatMessages } from '../../infrastructure/database/schema';
import { readTimelineTail } from '../../domain/shared/timelineTail';
import { TEAM_ORIGIN, MANAGER_ORIGIN } from './chatAccess';
import { chatDetailColumns, messageColumns, type TeamChatScope } from './brainChatShapes';
import { verifyProjectInTenant, verifyTeamInTenant } from './brainChatGuards';
import { appendRaw } from './brainMessageStore';
import type { Db } from '../../infrastructure/database/connection';

/** Resolve the ONE team chat for a scope, creating it on first access. Scope is
 *  a project (`projectId`), a named workforce team (`teamId`), or — when both are
 *  null — the tenant-wide "broader team". Race-safe: the unique `uq_team_chat_scope`
 *  index means a concurrent create just re-selects the winner. `userId` may be null
 *  (an unattended agent resolving it). */
export async function findTeamChat(db: Db, tenantId: number, scope: TeamChatScope) {
  return findScopedChat(db, tenantId, TEAM_ORIGIN, scope);
}

/**
 * The live (non-archived) chat that IS a given scope, for any singleton-chat origin.
 *
 * Shared by the team chat (0294) and the manager chat (0376) because they are the
 * same shape — one canonical conversation per (tenant, origin, scope), backed by a
 * partial unique index and resolved by get-or-create. Duplicating the lookup is how
 * two "always-there" chats drift into disagreeing about what "already exists" means,
 * and a forked singleton chat loses half its transcript on the next read.
 */
export async function findScopedChat(db: Db, tenantId: number, origin: string, scope: TeamChatScope) {
  const [row] = await db
    .select(chatDetailColumns)
    .from(brainChats)
    .where(and(
      eq(brainChats.tenantId, tenantId),
      eq(brainChats.origin, origin),
      eq(brainChats.isArchived, false),
      scope.projectId != null ? eq(brainChats.projectId, scope.projectId) : isNull(brainChats.projectId),
      scope.teamId != null ? eq(brainChats.teamId, scope.teamId) : isNull(brainChats.teamId),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve the ONE MANAGER chat for a project, creating it on first access (0376).
 *
 * This is where a person holds the AI Manager to account — "what did you and the team
 * get done today, and why not more?" — so it is deliberately a real Brain chat rather
 * than a bespoke Q&A log: it inherits the transcript, the members, the agent
 * participants, the addressed-agent reply loop and the tool trace, and the manager
 * answers through the SAME path any other agent teammate answers through.
 *
 * `visibility: 'shared'` because the manager's account of the team's day belongs to
 * the team, not to whoever opened the page first. Race-safe via `uq_manager_chat_scope`.
 */
export async function getOrCreateManagerChat(db: Db, tenantId: number, userId: string | null, projectId: number) {
  const proj = await verifyProjectInTenant(db, projectId, tenantId);
  if (!proj) return { error: 'Project not found in tenant' as const };

  let chat = await findScopedChat(db, tenantId, MANAGER_ORIGIN, { projectId });
  if (!chat) {
    try {
      const [created] = await db
        .insert(brainChats)
        .values({
          tenantId, userId: userId ?? null, origin: MANAGER_ORIGIN, projectId,
          title: `${proj.name} — Manager`, visibility: 'shared',
        })
        .returning(chatDetailColumns);
      chat = created ?? null;
    } catch {
      // Lost the create race (unique index) — the winner is now selectable.
      chat = await findScopedChat(db, tenantId, MANAGER_ORIGIN, { projectId });
    }
  }
  if (!chat) return { error: 'Chat not found' as const };

  const { ownerId, ...rest } = chat as unknown as Record<string, unknown> & { ownerId: string | null };
  return {
    ...rest,
    id: (chat as unknown as { id: number }).id,
    isOwner: ownerId != null && ownerId === userId,
    visibility: (rest as { visibility?: string }).visibility ?? 'shared',
    isManagerChat: true as const,
  };
}

export async function getOrCreateTeamChat(db: Db, tenantId: number, userId: string | null, scope: TeamChatScope = {}) {
  const projectId = scope.projectId ?? null;
  const teamId = scope.teamId ?? null;
  let title = 'Team Chat';
  if (projectId != null) {
    const proj = await verifyProjectInTenant(db, projectId, tenantId);
    if (!proj) return { error: 'Project not found in tenant' as const };
    title = `${proj.name} — Team`;
  } else if (teamId != null) {
    const team = await verifyTeamInTenant(db, teamId, tenantId);
    if (!team) return { error: 'Team not found in tenant' as const };
    title = `${team.name}`;
  }

  let chat = await findTeamChat(db, tenantId, { projectId, teamId });
  if (!chat) {
    try {
      const [created] = await db
        .insert(brainChats)
        .values({ tenantId, userId: userId ?? null, origin: TEAM_ORIGIN, projectId, teamId, title, visibility: 'shared' })
        .returning(chatDetailColumns);
      chat = created ?? null;
    } catch {
      // Lost the create race (unique index) — the winner is now selectable.
      chat = await findTeamChat(db, tenantId, { projectId, teamId });
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
export async function readTeamChat(db: Db, tenantId: number, scope: TeamChatScope, limit = 30) {
  const resolved = await getOrCreateTeamChat(db, tenantId, null, scope);
  if ('error' in resolved) return resolved;
  const msgs = await readTimelineTail(
    (rows) => db
      .select(messageColumns)
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, resolved.id as number))
      .orderBy(desc(brainChatMessages.seq))
      .limit(rows),
    limit,
    100,
  );
  return { chatId: resolved.id, messages: msgs };
}

/** Post a message INTO a team chat as an agent (agent-facing — no human userId
 *  gate; the server resolves the tenant's own canonical chat). Attribution rides
 *  metadata.authoredBy, mirroring {@link agentReply}. */
export async function postToTeamChat(
  db: Db,
  tenantId: number,
  scope: TeamChatScope,
  content: string,
  opts?: { fromName?: string; fromRef?: string },
) {
  const text = content?.trim();
  if (!text) return { error: 'content is required' as const };
  const resolved = await getOrCreateTeamChat(db, tenantId, null, scope);
  if ('error' in resolved) return resolved;
  const metadata = JSON.stringify({
    via: 'team_chat.post',
    authoredBy: { kind: 'agent', ref: opts?.fromRef ?? 'agent', ...(opts?.fromName ? { name: opts.fromName } : {}) },
  });
  const [msg] = await appendRaw(db, resolved.id as number, [{ role: 'assistant', content: text, metadata }]);
  return { chatId: resolved.id, message: msg ?? null };
}

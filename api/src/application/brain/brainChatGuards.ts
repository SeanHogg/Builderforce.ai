/**
 * Brain chat ACCESS guards — owner gate, shared-access gate, audience membership,
 * and the tenant checks for projects/teams a chat points at. Split out of
 * `BrainService.ts`; every chat-scoped use case goes through these.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { eq, and, inArray } from 'drizzle-orm';
import { brainChats, chatMembers, projects, teams } from '../../infrastructure/database/schema';
import {
  BRAIN_ORIGIN, ACCESSIBLE_ORIGINS,
  resolveChatAccess, syncPendingMemberships as syncPendingMembershipsShared,
} from './chatAccess';
import { loadProjectInTenant } from '../project/projectOwnership';
import type { Db } from '../../infrastructure/database/connection';
import { bumpChatStructure } from './chatCacheVersions';

/**
 * The OWNER gate for rename / archive.
 *
 * Two shapes of chat come through here and they are not owned the same way:
 *
 *  - `brainstorm` is somebody's conversation. It has a `user_id`, and only
 *    that person may rename or archive it.
 *  - `team` (0294) and `manager` (0376) are SINGLETONS of a scope — one per
 *    (tenant, project) — created by the system with `user_id` NULL. Nobody
 *    "owns" one, so this gate rejected every PATCH/DELETE against them with
 *    "Chat not found": correct-by-accident while no surface offered rename,
 *    and a silent 404 the moment one did.
 *
 * So a singleton is administered rather than owned: `isWorkspaceAdmin` (the
 * caller's tenant role, resolved at the route) is what authorises it. A
 * member without that role still gets "Chat not found" — the same answer as
 * before, and deliberately not a 403, since the alternative leaks which chats
 * exist.
 */
export async function verifyChatOwnership(
  db: Db,
  chatId: number,
  tenantId: number,
  userId: string,
  selectExtra?: Record<string, unknown>,
  options: { isWorkspaceAdmin?: boolean } = {},
) {
  const columns = { id: brainChats.id, origin: brainChats.origin, ...(selectExtra ?? {}) };
  const [chat] = await db
    .select(columns as typeof columns & { id: typeof brainChats.id })
    .from(brainChats)
    .where(
      and(
        eq(brainChats.id, chatId),
        eq(brainChats.tenantId, tenantId),
        options.isWorkspaceAdmin
          ? inArray(brainChats.origin, [...ACCESSIBLE_ORIGINS])
          : eq(brainChats.origin, BRAIN_ORIGIN),
      ),
    )
    .limit(1);
  if (!chat) return null;
  // A personal chat is still personal to an admin: administering the workspace
  // does not mean reading, renaming or archiving a colleague's conversation.
  const origin = (chat as { origin?: string | null }).origin ?? BRAIN_ORIGIN;
  if (origin === BRAIN_ORIGIN) {
    const [owned] = await db
      .select({ id: brainChats.id })
      .from(brainChats)
      .where(and(eq(brainChats.id, chatId), eq(brainChats.tenantId, tenantId), eq(brainChats.userId, userId)))
      .limit(1);
    if (!owned) return null;
  }
  return chat;
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
export async function canAccessChat(
  db: Db,
  chatId: number,
  tenantId: number,
  userId: string,
  selectExtra?: Record<string, unknown>,
) {
  // Single shared-access guard — the SAME one ChatTicketService uses, so a chat
  // that reads here also resolves for its tickets/agents/members ({@link resolveChatAccess}).
  return resolveChatAccess(db, { chatId, tenantId, userId, selectExtra });
}

/** Record a contributing non-owner as an active member (the chat's audience),
 *  idempotent. Owners are skipped. Best-effort — a race just no-ops on the
 *  unique (chat_id, user_id) index. */
export async function ensureMembership(db: Db, chatId: number, tenantId: number, userId: string, ownerId: string | null): Promise<void> {
  if (!userId || userId === ownerId) return;
  try {
    // One statement: an existing row (whatever its status) wins on the unique
    // (chat_id, user_id) index, exactly as the old read-then-insert left it alone.
    const added = await db.insert(chatMembers)
      .values({ chatId, tenantId, userId, status: 'active', role: 'participant' })
      .onConflictDoNothing({ target: [chatMembers.chatId, chatMembers.userId] })
      .returning({ id: chatMembers.id });
    if (added.length > 0) await bumpChatStructure(chatId);
  } catch (error) {
    /* audience tracking is non-critical — never fail a post over it */
  
    reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "ensureMembership" });
  }
}

/** Activate any pending chat-member invites for this user (shared helper). */
export function syncPendingMemberships(db: Db, tenantId: number, userId: string): Promise<number[]> {
  return syncPendingMembershipsShared(db, tenantId, userId);
}

export async function verifyProjectInTenant(db: Db, projectId: number, tenantId: number) {
  return loadProjectInTenant(db, tenantId, projectId, { id: projects.id, name: projects.name });
}

/**
 * Whether a chat id names a chat in this tenant — the ownership gate for a chat id
 * a CALLER supplied as attribution (`metadata.chatId` on a gateway completion). Not
 * an access check: it answers "may this tenant's spend and activity name that chat",
 * which a guessed or a device-local number must not (PRD 36, D2).
 */
export async function chatInTenant(db: Db, tenantId: number, chatId: number): Promise<boolean> {
  const [chat] = await db
    .select({ id: brainChats.id })
    .from(brainChats)
    .where(and(eq(brainChats.id, chatId), eq(brainChats.tenantId, tenantId)))
    .limit(1);
  return !!chat;
}

export async function verifyTeamInTenant(db: Db, teamId: number, tenantId: number) {
  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
    .limit(1);
  return team ?? null;
}

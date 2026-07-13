/**
 * chatAccess — the SINGLE source of truth for "may this caller reach this Brain
 * chat?". Both {@link BrainService} (read/post) and {@link ChatTicketService}
 * (tickets / agents / members / consolidate) delegate here so the access rules
 * live ONCE (DRY). Before this was extracted the two services carried divergent
 * guards: BrainService accepted team group chats + shared-visibility teammates,
 * while ChatTicketService silently required brainstorm-origin AND ownership — so
 * opening a team chat, or a teammate opening a SHARED brainstorm chat, rendered
 * fine but 404'd ("Chat not found") on its tickets/agents/members.
 *
 * A Brain chat is global to its (tenant, project); access depends on VISIBILITY:
 *   • gateway/MCP callers (userId === null) → tenant-wide access (matches brain.*).
 *   • owner                                 → always.
 *   • 'shared' (default)                    → any teammate in the tenant.
 *   • 'locked'                              → owner or an active member; a pending
 *                                             email-invite for this user is lazily
 *                                             converted first so a deep-link works.
 *
 * Owner-only ADMIN (rename/archive/lock) is a STRICTER gate and stays in
 * BrainService.verifyChatOwnership — this module is the shared-ACCESS gate only.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { brainChats, chatMembers, users } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export const BRAIN_ORIGIN = 'brainstorm';
/** The always-there team GROUP chat (migration 0294): reuses the whole Brain chat
 *  stack, one per (tenant, projectId), projectId NULL = tenant-wide. */
export const TEAM_ORIGIN = 'team';
/** Origins reachable through the shared chat access/message endpoints. */
export const ACCESSIBLE_ORIGINS = [BRAIN_ORIGIN, TEAM_ORIGIN] as const;

/** The user's email, lower-cased (for pending-invite matching). */
export async function getUserEmail(db: Db, userId: string): Promise<string | null> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.email?.toLowerCase() ?? null;
}

/**
 * Activate any pending chat-member invites whose `invited_email` matches this
 * user's address — the auto-conversion that mirrors tenant_invitations. Single
 * bounded UPDATE keyed on the indexed lower(invited_email); a no-op (0 rows) when
 * the user has no pending invites. Returns the chat ids that just converted.
 */
export async function syncPendingMemberships(db: Db, tenantId: number, userId: string): Promise<number[]> {
  const email = await getUserEmail(db, userId);
  if (!email) return [];
  const rows = await db
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

/**
 * The shared chat-access guard. Returns the chat row (id + ownerId + visibility,
 * plus any `selectExtra` columns) when the caller may access it, else null.
 *
 * `userId === null` is the gateway/MCP path: tenant-wide access, matching the
 * brain.* built-in tools (no per-user visibility gate).
 */
export async function resolveChatAccess<E extends Record<string, unknown> = Record<string, never>>(
  db: Db,
  params: { chatId: number; tenantId: number; userId: string | null; selectExtra?: E },
): Promise<({ id: number; ownerId: string | null; visibility: string } & { [K in keyof E]: unknown }) | null> {
  const { chatId, tenantId, userId, selectExtra } = params;
  const columns = {
    id: brainChats.id,
    ownerId: brainChats.userId,
    visibility: brainChats.visibility,
    ...(selectExtra ?? {}),
  };
  const [chat] = await db
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
  // Gateway/MCP callers (no user identity) get tenant-wide access.
  if (!userId) return chat as never;
  if (c.ownerId === userId) return chat as never;   // owner
  if (c.visibility !== 'locked') return chat as never; // shared → any teammate

  // Locked: owner or active member only.
  const isMember = async () => {
    const [m] = await db
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
  if (await isMember()) return chat as never;
  // Maybe a pending invite addressed this user's email — convert then re-check.
  await syncPendingMemberships(db, tenantId, userId);
  if (await isMember()) return chat as never;
  return null;
}

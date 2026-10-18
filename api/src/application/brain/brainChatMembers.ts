/**
 * Human members of a Brain chat (shared access, migration 0288) — roster, invite by
 * email, remove. Split out of `BrainService.ts`.
 */

import { eq, and, sql } from 'drizzle-orm';
import { brainChats, chatMembers, users, tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { invite } from '../kernel/InvitationService';
import { canAccessChat, verifyChatOwnership } from './brainChatGuards';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpChatStructure } from './chatCacheVersions';

/** Active human members of a chat (owner or any member may read the roster). */
export async function listMembers(db: Db, chatId: number, tenantId: number, userId: string) {
  const chat = await canAccessChat(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' as const };
  const rows = await db
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
export async function inviteHuman(
  db: Db,
  chatId: number,
  tenantId: number,
  userId: string,
  input: { email: string },
  /** Needed to invalidate the tenant's cached invitation roster when the
   *  workspace invite is created — `BrainService` holds a `Db`, not an `Env`,
   *  so the caller that has one passes it. */
  env: Env,
): Promise<
  | { error: string }
  | { status: 'active' | 'pending'; memberUserId: string | null; email: string; chatTitle: string; already: boolean }
> {
  const chat = await verifyChatOwnership(db, chatId, tenantId, userId, { title: brainChats.title }) as
    | { id: number; title: string }
    | null;
  if (!chat) return { error: 'Chat not found' };
  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A valid email is required' };

  // Resolve the email to an existing active member of THIS tenant (so their
  // tenant-scoped token can actually reach the chat).
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(tenantMembers, and(eq(tenantMembers.userId, users.id), eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)))
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existingUser) {
    if (existingUser.id === userId) return { error: 'You already own this chat' };
    const [dup] = await db.select({ id: chatMembers.id })
      .from(chatMembers)
      .where(scopedToTenant(chatMembers, tenantId, eq(chatMembers.chatId, chatId), eq(chatMembers.userId, existingUser.id)))
      .limit(1);
    if (!dup) {
      await db.insert(chatMembers).values({
        chatId, tenantId, userId: existingUser.id, status: 'active', invitedBy: userId,
      });
      await bumpChatStructure(chatId, env);
    }
    return { status: 'active', memberUserId: existingUser.id, email, chatTitle: chat.title, already: !!dup };
  }

  // Cold invite — pending row keyed on the email, converts on first access.
  const [dup] = await db.select({ id: chatMembers.id })
    .from(chatMembers)
    .where(scopedToTenant(chatMembers, tenantId, eq(chatMembers.chatId, chatId), sql`lower(${chatMembers.invitedEmail}) = ${email}`))
    .limit(1);
  if (!dup) {
    await db.insert(chatMembers).values({
      chatId, tenantId, invitedEmail: email, status: 'pending', invitedBy: userId,
    });
    await bumpChatStructure(chatId, env);
    // Also drop a pending TENANT invitation so the cold invitee actually gets a
    // tenant account on signup (the existing tenant-invite auto-conversion adds
    // them to tenant_members). Once in the tenant, syncPendingMemberships promotes
    // their chat membership to active — completing the join with no extra step.
    // Find-or-refresh, in the kernel service that owns the primitive — the
    // select-then-insert this replaced raced with itself and normalised the
    // address on the read but not on the write.
    await invite(db, env, {
      tenantId,
      kind: 'tenant',
      email,
      role: 'developer',
      invitedBy: userId,
    });
  }
  return { status: 'pending', memberUserId: null, email, chatTitle: chat.title, already: !!dup };
}

/** Remove a human member from a chat (owner only). */
export async function removeMember(db: Db, chatId: number, tenantId: number, userId: string, memberId: number) {
  const chat = await verifyChatOwnership(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' as const };
  const rows = await db
    .delete(chatMembers)
    .where(and(eq(chatMembers.id, memberId), eq(chatMembers.chatId, chatId), eq(chatMembers.tenantId, tenantId)))
    .returning({ id: chatMembers.id });
  if (rows.length > 0) await bumpChatStructure(chatId);
  return { removed: rows.length > 0 };
}

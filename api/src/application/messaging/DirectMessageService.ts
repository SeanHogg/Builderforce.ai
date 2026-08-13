/**
 * The direct-message hub — a sales associate and the platform owner, talking.
 *
 * ── ZERO NEW TABLES ──────────────────────────────────────────────────────────
 * The kernel already models this exactly (PRD 20 §7): a conversation is a
 * `threads` row — whose own comment lists `'dm'` among its kinds — its people are
 * `memberships` rows, and its body is `messages` rows. A `dm_threads` /
 * `dm_participants` / `dm_messages` trio would be the thirteenth copy of the
 * shape `messages` was written to absorb. The only kernel requirement to satisfy
 * is that `memberships.object_id` is NOT NULL, so each thread gets its `objects`
 * row of kind `'thread'` — which is the containment record the canvas and the
 * activity log read anyway.
 *
 * ── WHO MAY TALK TO WHOM ─────────────────────────────────────────────────────
 * Deliberately narrow, and decided HERE rather than at the route: an associate
 * may open a thread with the platform owners, and a platform owner may open one
 * with any associate. There is no associate↔associate channel, because the
 * feature is "reach the person who runs the programme", and a general-purpose
 * social graph is a different product with different moderation obligations.
 *
 * ── LIVE ─────────────────────────────────────────────────────────────────────
 * The REST routes stay the source of truth and the relay only says "changed"
 * (`SessionRoomDO`), which is the pattern poker, retros, the board and Brain
 * chats already use. Two rooms per event: the THREAD room, so an open
 * conversation appends without a poll, and each participant's PERSONAL room, so
 * the top-bar badge lights up for someone who has no thread open.
 */

import { and, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { memberships, messages, objects, tenantMembers, threads, users } from '../../infrastructure/database/schema';
import { broadcastRoom } from '../../infrastructure/relay/broadcastRoom';
import { notify } from '../notifications/notify';

/** The live room for one conversation. */
export const dmThreadRoomName = (threadId: string): string => `dm:${threadId}`;
/** The live room for one PERSON — every thread they are in reports here too, so
 *  the unread badge updates with nothing open. */
export const dmUserRoomName = (userId: string): string => `dm-user:${userId}`;

const MAX_BODY = 4000;
const THREADS_PAGE = 50;
const MESSAGES_PAGE = 200;

export interface DirectMessageParticipant {
  userId: string;
  name: string | null;
  email: string;
  isSuperadmin: boolean;
}

export interface DirectMessageThreadView {
  id: string;
  subject: string;
  lastMessageAtISO: string | null;
  messageCount: number;
  unread: number;
  participants: DirectMessageParticipant[];
}

export interface DirectMessageView {
  id: number;
  threadId: string;
  authorUserId: string;
  authorName: string | null;
  body: string;
  createdAtISO: string;
  /** True when the author is the reader — the one thing a bubble needs to know. */
  mine: boolean;
}

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export class DirectMessageService {
  constructor(private readonly db: Db, private readonly env: Env) {}

  private async person(userId: string) {
    const [row] = await this.db.select({
      id: users.id, email: users.email, name: users.displayName,
      isSuperadmin: users.isSuperadmin, accountType: users.accountType,
    }).from(users).where(eq(users.id, userId)).limit(1);
    return row;
  }

  /**
   * Who this person is allowed to start a conversation with.
   *
   * A superadmin sees every sales associate; everyone else sees the superadmins.
   * Returned as a LIST rather than as a boolean check at send time, because the
   * UI has to render the picker and a second definition of the rule is how the
   * picker and the guard drift.
   */
  async contacts(userId: string): Promise<DirectMessageParticipant[]> {
    const me = await this.person(userId);
    if (!me) return [];
    const rows = me.isSuperadmin
      ? await this.db.select({ id: users.id, email: users.email, name: users.displayName, isSuperadmin: users.isSuperadmin })
        .from(users).where(and(eq(users.accountType, 'sales'), ne(users.id, userId))).orderBy(desc(users.createdAt))
      : await this.db.select({ id: users.id, email: users.email, name: users.displayName, isSuperadmin: users.isSuperadmin })
        .from(users).where(eq(users.isSuperadmin, true));
    return rows.map((row) => ({ userId: row.id, name: row.name, email: row.email, isSuperadmin: row.isSuperadmin }));
  }

  /**
   * Every workspace this person can read a conversation in.
   *
   * A web token carries no tenant claim, so scope is resolved here rather than
   * demanded from the route — the same reason `open()` resolves the workspace it
   * writes into. A DM thread belongs to a workspace (`threads.tenantId`, set at
   * open time), and `check-tenant-scope` is the rule that says a read of a
   * tenant-owned table names the tenant it is reading.
   *
   * A SUPERADMIN is cross-tenant here by design, and this is the one place that
   * has to say so. The whole feature is superadmin ↔ sales associate
   * (see `contacts`), and `open()` files the thread under the ASSOCIATE's
   * workspace — never the superadmin's, because a superadmin has no workspace in
   * this conversation's sense. Scoping them to their own `tenantMembers` rows
   * would therefore hide every thread they are actually in, which is the whole
   * inbox. So their scope is the set of workspaces they hold an active
   * membership in: still a concrete tenant list on every read, still only rows
   * reached through their OWN membership, and no wider than the conversations
   * they were added to.
   */
  private async reachableTenantIds(userId: string): Promise<number[]> {
    const [me, memberRows] = await Promise.all([
      this.person(userId),
      this.db.select({ tenantId: tenantMembers.tenantId }).from(tenantMembers)
        .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.isActive, true))),
    ]);
    const ids = new Set(memberRows.map((row) => row.tenantId));
    if (me?.isSuperadmin) {
      // Discovery, not a listing: this asks "which workspaces am I a participant
      // in", so it is keyed by the caller's own `memberRef` and cannot return
      // anyone else's rows. It is the query that PRODUCES the tenant filter every
      // other read then carries.
      const participantRows = await this.db.select({ tenantId: memberships.tenantId }).from(memberships)
        .where(and(
          eq(memberships.memberKind, 'user'),
          eq(memberships.memberRef, userId),
          eq(memberships.state, 'active'),
        ));
      for (const row of participantRows) ids.add(row.tenantId);
    }
    return [...ids];
  }

  /** The workspace a person's threads belong to — their first active membership. */
  private async workspaceOf(userId: string): Promise<number | null> {
    const [row] = await this.db.select({ tenantId: tenantMembers.tenantId }).from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.isActive, true)))
      .orderBy(tenantMembers.tenantId).limit(1);
    return row?.tenantId ?? null;
  }

  private async mayReach(userId: string, otherId: string): Promise<boolean> {
    if (userId === otherId) return false;
    const [me, them] = await Promise.all([this.person(userId), this.person(otherId)]);
    if (!me || !them) return false;
    // Symmetric by construction: owner↔associate, in either direction.
    return (me.isSuperadmin && them.accountType === 'sales') || (them.isSuperadmin && me.accountType === 'sales');
  }

  /** Thread ids this person is a participant of. */
  private async myThreadIds(userId: string, tenantIds: number[]): Promise<string[]> {
    if (tenantIds.length === 0) return [];
    const rows = await this.db.select({ objectId: memberships.objectId, updatedAt: memberships.updatedAt })
      .from(memberships)
      .where(and(
        inArray(memberships.tenantId, tenantIds),
        eq(memberships.memberKind, 'user'),
        eq(memberships.memberRef, userId),
        eq(memberships.state, 'active'),
      ))
      .orderBy(desc(memberships.updatedAt))
      .limit(THREADS_PAGE * 4);
    if (rows.length === 0) return [];
    // `memberships` is the kernel's presence table for EVERY object, so the rows
    // have to be narrowed to threads — a board membership is not a conversation.
    const objectRows = await this.db.select({ id: objects.id, refId: objects.refId })
      .from(objects).where(and(
        inArray(objects.tenantId, tenantIds),
        inArray(objects.id, rows.map((row) => row.objectId)),
        eq(objects.kind, 'thread'),
      ));
    return objectRows.map((row) => row.refId);
  }

  /**
   * Every conversation this person is in, newest first, with unread counts.
   *
   * Unread is `messages since my membership's lastSeenAt`, counted in ONE grouped
   * query rather than one COUNT per thread — the N+1 the performance rule names.
   */
  async threads(userId: string): Promise<DirectMessageThreadView[]> {
    const tenantIds = await this.reachableTenantIds(userId);
    const ids = await this.myThreadIds(userId, tenantIds);
    if (ids.length === 0) return [];

    const [threadRows, memberRows] = await Promise.all([
      this.db.select().from(threads)
        .where(and(inArray(threads.tenantId, tenantIds), inArray(threads.id, ids)))
        .orderBy(desc(threads.lastMessageAt)).limit(THREADS_PAGE),
      this.db.select({
        objectRefId: objects.refId, memberRef: memberships.memberRef, lastSeenAt: memberships.lastSeenAt,
        name: users.displayName, email: users.email, isSuperadmin: users.isSuperadmin,
      }).from(memberships)
        .innerJoin(objects, eq(objects.id, memberships.objectId))
        .leftJoin(users, eq(users.id, memberships.memberRef))
        .where(and(
          inArray(memberships.tenantId, tenantIds),
          eq(objects.kind, 'thread'), inArray(objects.refId, ids), eq(memberships.state, 'active'),
        )),
    ]);

    const participantsByThread = new Map<string, DirectMessageParticipant[]>();
    const myCursor = new Map<string, Date>();
    for (const row of memberRows) {
      const list = participantsByThread.get(row.objectRefId) ?? [];
      list.push({ userId: row.memberRef, name: row.name ?? null, email: row.email ?? '', isSuperadmin: row.isSuperadmin ?? false });
      participantsByThread.set(row.objectRefId, list);
      if (row.memberRef === userId) myCursor.set(row.objectRefId, row.lastSeenAt ?? new Date(0));
    }

    // Unread, in ONE grouped query rather than one COUNT per thread. Each thread
    // carries its OWN read cursor, so the predicate is an OR of per-thread
    // clauses — bounded by the page size, and still a single round trip.
    const clauses = threadRows.map((row) => and(
      eq(messages.threadId, row.id),
      gt(messages.createdAt, myCursor.get(row.id) ?? new Date(0)),
    ));
    const unreadRows = clauses.length === 0 ? [] : await this.db
      .select({ threadId: messages.threadId, total: sql<string>`count(*)` })
      .from(messages)
      .where(and(inArray(messages.tenantId, tenantIds), ne(messages.authorRef, userId), or(...clauses)))
      .groupBy(messages.threadId);
    const unreadByThread = new Map(unreadRows.map((row) => [row.threadId, Number(row.total) || 0]));

    return threadRows.map((row) => ({
      id: row.id,
      subject: row.title ?? '',
      lastMessageAtISO: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      messageCount: row.messageCount,
      unread: unreadByThread.get(row.id) ?? 0,
      participants: participantsByThread.get(row.id) ?? [],
    }));
  }

  /** Total unread across every conversation — the top-bar badge, in one query. */
  async unreadCount(userId: string): Promise<number> {
    const list = await this.threads(userId);
    return list.reduce((sum, thread) => sum + thread.unread, 0);
  }

  private async isParticipant(threadId: string, userId: string, tenantIds: number[]): Promise<boolean> {
    if (tenantIds.length === 0) return false;
    const [row] = await this.db.select({ id: memberships.id }).from(memberships)
      .innerJoin(objects, eq(objects.id, memberships.objectId))
      .where(and(
        inArray(memberships.tenantId, tenantIds),
        eq(objects.kind, 'thread'), eq(objects.refId, threadId),
        eq(memberships.memberKind, 'user'), eq(memberships.memberRef, userId), eq(memberships.state, 'active'),
      )).limit(1);
    return row != null;
  }

  /** One conversation's messages, oldest first (a transcript reads downward). */
  async messages(threadId: string, userId: string): Promise<DirectMessageView[] | null> {
    const tenantIds = await this.reachableTenantIds(userId);
    if (!await this.isParticipant(threadId, userId, tenantIds)) return null;
    const rows = await this.db.select({
      id: messages.id, threadId: messages.threadId, authorRef: messages.authorRef,
      body: messages.body, createdAt: messages.createdAt, name: users.displayName,
    }).from(messages)
      .leftJoin(users, eq(users.id, messages.authorRef))
      .where(and(inArray(messages.tenantId, tenantIds), eq(messages.threadId, threadId)))
      .orderBy(messages.createdAt)
      .limit(MESSAGES_PAGE);
    return rows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      authorUserId: row.authorRef ?? '',
      authorName: row.name ?? null,
      body: row.body ?? '',
      createdAtISO: row.createdAt.toISOString(),
      mine: row.authorRef === userId,
    }));
  }

  /**
   * Open a conversation with someone, or return the one already open.
   *
   * "Or return the one already open" is the whole reason this is not a plain
   * insert: a rep who clicks "Message Sean" three times must not end up with
   * three threads nobody can tell apart. A NEW subject is an explicit new thread
   * — the brief says a rep may start one or many — so the reuse is keyed on the
   * pair AND an empty subject.
   */
  async open(userId: string, otherUserId: string, subject: string): Promise<DirectMessageThreadView | null> {
    if (!await this.mayReach(userId, otherUserId)) return null;
    // A web token carries no tenant claim, so the thread's workspace is resolved
    // here rather than demanded from the route — and it is the OPENER's, because
    // a superadmin has no workspace of their own in this conversation's sense.
    const tenantId = await this.workspaceOf(userId) ?? await this.workspaceOf(otherUserId);
    if (tenantId == null) return null;
    const title = clean(subject, 200);

    if (!title) {
      const mine = await this.threads(userId);
      const existing = mine.find((thread) => !thread.subject && thread.participants.some((p) => p.userId === otherUserId));
      if (existing) return existing;
    }

    const [thread] = await this.db.insert(threads).values({
      tenantId, kind: 'dm', title: title || null, mode: 'chat', status: 'open', createdBy: userId,
    }).returning();
    if (!thread) return null;

    const [object] = await this.db.insert(objects).values({
      tenantId, kind: 'thread', refId: thread.id, domain: 'CRO', title: title || 'Direct message',
    }).onConflictDoUpdate({
      target: [objects.tenantId, objects.kind, objects.refId],
      set: { title: title || 'Direct message', updatedAt: new Date() },
    }).returning();
    if (!object) return null;

    await this.db.insert(memberships).values([userId, otherUserId].map((memberRef) => ({
      tenantId, objectId: object.id, memberKind: 'user', memberRef,
      role: memberRef === userId ? 'owner' : 'member', state: 'active', joinedAt: new Date(),
    }))).onConflictDoNothing({
      target: [memberships.tenantId, memberships.objectId, memberships.memberKind, memberships.memberRef],
    });

    await broadcastRoom(this.env.SESSION_ROOM, dmUserRoomName(otherUserId));
    const [view] = (await this.threads(userId)).filter((row) => row.id === thread.id);
    return view ?? null;
  }

  /** Append a message and wake everyone who should see it. */
  async send(threadId: string, userId: string, body: string): Promise<DirectMessageView | null> {
    const text = clean(body, MAX_BODY);
    if (!text) return null;
    const tenantIds = await this.reachableTenantIds(userId);
    if (!await this.isParticipant(threadId, userId, tenantIds)) return null;

    const [thread] = await this.db.select({ id: threads.id, tenantId: threads.tenantId, title: threads.title })
      .from(threads).where(and(inArray(threads.tenantId, tenantIds), eq(threads.id, threadId))).limit(1);
    if (!thread) return null;

    const now = new Date();
    const [row] = await this.db.insert(messages).values({
      tenantId: thread.tenantId, threadId, authorKind: 'user', authorRef: userId, role: 'user', body: text,
    }).returning();
    if (!row) return null;

    await this.db.update(threads)
      // `messageCount` is denormalised on purpose (the kernel says so): a thread
      // list must not fan out one COUNT per row.
      .set({ lastMessageAt: now, messageCount: sql`${threads.messageCount} + 1`, updatedAt: now })
      .where(and(eq(threads.tenantId, thread.tenantId), eq(threads.id, threadId)));
    // The sender has, by definition, seen their own message.
    await this.markRead(threadId, userId, now);

    const participants = await this.participantIds(threadId, thread.tenantId);
    const me = await this.person(userId);
    await Promise.all([
      broadcastRoom(this.env.SESSION_ROOM, dmThreadRoomName(threadId)),
      ...participants.map((participant) => broadcastRoom(this.env.SESSION_ROOM, dmUserRoomName(participant))),
      // A durable notification for the people who are not looking at the app.
      // The relay is best-effort by design; a message nobody saw is not.
      ...participants.filter((participant) => participant !== userId).map((participant) => notify(this.db, this.env, {
        userId: participant,
        tenantId: thread.tenantId,
        kind: 'messages.direct',
        title: `${me?.name || me?.email || 'A teammate'} sent you a message`,
        body: text.slice(0, 240),
        ref: `/messages?thread=${threadId}`,
      })),
    ]);

    return {
      id: row.id, threadId, authorUserId: userId, authorName: me?.name ?? null,
      body: text, createdAtISO: row.createdAt.toISOString(), mine: true,
    };
  }

  private async participantIds(threadId: string, tenantId: number): Promise<string[]> {
    const rows = await this.db.select({ memberRef: memberships.memberRef }).from(memberships)
      .innerJoin(objects, eq(objects.id, memberships.objectId))
      .where(and(
        eq(memberships.tenantId, tenantId),
        eq(objects.kind, 'thread'), eq(objects.refId, threadId), eq(memberships.state, 'active'),
      ));
    return rows.map((row) => row.memberRef);
  }

  /** Mark everything up to `at` seen. `lastSeenAt` on the membership IS the read
   *  cursor — a separate read-state table would be a second copy of presence. */
  async markRead(threadId: string, userId: string, at = new Date()): Promise<boolean> {
    const tenantIds = await this.reachableTenantIds(userId);
    if (tenantIds.length === 0) return false;
    const [object] = await this.db.select({ id: objects.id }).from(objects)
      .where(and(
        inArray(objects.tenantId, tenantIds),
        eq(objects.kind, 'thread'), eq(objects.refId, threadId),
      )).limit(1);
    if (!object) return false;
    await this.db.update(memberships).set({ lastSeenAt: at, updatedAt: at })
      .where(and(
        inArray(memberships.tenantId, tenantIds),
        eq(memberships.objectId, object.id),
        eq(memberships.memberKind, 'user'),
        eq(memberships.memberRef, userId),
      ));
    await broadcastRoom(this.env.SESSION_ROOM, dmUserRoomName(userId));
    return true;
  }
}

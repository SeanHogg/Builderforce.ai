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
 * ── AND ZERO SECOND COPIES OF THE MECHANICS ──────────────────────────────────
 * Those mechanics — register the object, hang memberships off it, bump the
 * denormalised `message_count`, treat `last_seen_at` as the read cursor — were
 * written HERE first and now live in `kernelThreads.ts`, because the résumé
 * review queue is the second conversation to need every one of them. What stays
 * in this file is the only part that is actually about direct messages: who may
 * reach whom, and how a member ref becomes a named person.
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

import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { memberships, tenantMembers, users } from '../../infrastructure/database/schema';
import { broadcastRoom } from '../../infrastructure/relay/broadcastRoom';
import { notify } from '../notifications/notify';
import {
  appendKernelMessage, getKernelThread, isThreadParticipant, listKernelMessages, listKernelThreads,
  markKernelThreadRead, memberThreadIds, openKernelThread, threadMemberRefs,
} from './kernelThreads';

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

  /**
   * Display details for a set of user ids — the one thing a DM view needs that a
   * generic thread does not.
   *
   * `listKernelThreads` returns member REFS, because the kernel's presence table holds
   * agents and teams as readily as people and a primitive cannot assume a `users` row
   * exists for one. A direct message is the case where it always does, so the decoration
   * happens here, keyed on the refs already returned.
   */
  private async peopleByRef(ids: readonly string[]): Promise<Map<string, DirectMessageParticipant>> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return new Map();
    const rows = await this.db.select({
      id: users.id, email: users.email, name: users.displayName, isSuperadmin: users.isSuperadmin,
    }).from(users).where(inArray(users.id, unique));
    return new Map(rows.map((row) => [row.id, {
      userId: row.id, name: row.name, email: row.email, isSuperadmin: row.isSuperadmin,
    }]));
  }

  /**
   * Every conversation this person is in, newest first, with unread counts.
   *
   * The thread rows, their participants and the unread arithmetic all come from
   * {@link listKernelThreads} — the primitive the résumé review queue shares. What stays
   * here is the only DM-specific part: turning member refs into named people.
   */
  async threads(userId: string): Promise<DirectMessageThreadView[]> {
    const tenantIds = await this.reachableTenantIds(userId);
    const ids = await memberThreadIds(this.db, tenantIds, userId, THREADS_PAGE * 4);
    if (ids.length === 0) return [];

    const views = await listKernelThreads(this.db, {
      tenantIds, threadIds: ids, readerRef: userId, limit: THREADS_PAGE,
    });
    const people = await this.peopleByRef(views.flatMap((view) => view.members.map((member) => member.memberRef)));

    return views.map((view) => ({
      id: view.id,
      subject: view.title,
      lastMessageAtISO: view.lastMessageAtISO,
      messageCount: view.messageCount,
      unread: view.unread,
      participants: view.members.map((member) => people.get(member.memberRef)
        ?? { userId: member.memberRef, name: null, email: '', isSuperadmin: false }),
    }));
  }

  /** Total unread across every conversation — the top-bar badge, in one query. */
  async unreadCount(userId: string): Promise<number> {
    const list = await this.threads(userId);
    return list.reduce((sum, thread) => sum + thread.unread, 0);
  }

  /** One conversation's messages, oldest first (a transcript reads downward). */
  async messages(threadId: string, userId: string): Promise<DirectMessageView[] | null> {
    const tenantIds = await this.reachableTenantIds(userId);
    if (!await isThreadParticipant(this.db, tenantIds, threadId, userId)) return null;
    const rows = await listKernelMessages(this.db, tenantIds, threadId, MESSAGES_PAGE);
    const people = await this.peopleByRef(rows.map((row) => row.authorRef ?? ''));
    return rows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      authorUserId: row.authorRef ?? '',
      authorName: people.get(row.authorRef ?? '')?.name ?? null,
      body: row.body,
      createdAtISO: row.createdAtISO,
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

    const opened = await openKernelThread(this.db, {
      tenantId, kind: 'dm', title: title || null, domain: 'CRO',
      objectTitle: 'Direct message', createdBy: userId,
      members: [userId, otherUserId].map((memberRef) => ({
        memberKind: 'user' as const, memberRef, role: memberRef === userId ? 'owner' : 'member',
      })),
    });
    if (!opened) return null;

    await broadcastRoom(this.env.SESSION_ROOM, dmUserRoomName(otherUserId));
    const [view] = (await this.threads(userId)).filter((row) => row.id === opened.threadId);
    return view ?? null;
  }

  /** Append a message and wake everyone who should see it. */
  async send(threadId: string, userId: string, body: string): Promise<DirectMessageView | null> {
    const text = clean(body, MAX_BODY);
    if (!text) return null;
    const tenantIds = await this.reachableTenantIds(userId);
    if (!await isThreadParticipant(this.db, tenantIds, threadId, userId)) return null;

    const thread = await getKernelThread(this.db, tenantIds, threadId);
    if (!thread) return null;

    // The primitive owns the insert AND the denormalised `messageCount` / `lastMessageAt`
    // bump, so a second conversation kind cannot ship having forgotten one of them.
    const row = await appendKernelMessage(this.db, {
      tenantId: thread.tenantId, threadId, authorKind: 'user', authorRef: userId, role: 'user', body: text,
    });
    if (!row) return null;
    // The sender has, by definition, seen their own message.
    await this.markRead(threadId, userId, new Date());

    const participants = await threadMemberRefs(this.db, thread.tenantId, threadId);
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
      body: text, createdAtISO: row.createdAtISO, mine: true,
    };
  }

  /** Mark everything up to `at` seen, then light the reader's own badge down. */
  async markRead(threadId: string, userId: string, at = new Date()): Promise<boolean> {
    const tenantIds = await this.reachableTenantIds(userId);
    if (!await markKernelThreadRead(this.db, tenantIds, threadId, userId, at)) return false;
    await broadcastRoom(this.env.SESSION_ROOM, dmUserRoomName(userId));
    return true;
  }
}

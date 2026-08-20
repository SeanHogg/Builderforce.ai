/**
 * The KERNEL THREAD primitive — one conversation, however it is being used.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * PRD 20 §2.1 collapsed five conversation tables into `threads` + `messages`, with
 * presence in `memberships` and the containment record in `objects`. That collapse is
 * only worth anything if the CODE collapses too. `DirectMessageService` opened the first
 * conversation on those tables and, in doing so, wrote the mechanics down for the first
 * time: a thread needs an `objects` row (because `memberships.object_id` is NOT NULL),
 * a message has to bump the denormalised `message_count`, and the read cursor is
 * `memberships.last_seen_at` rather than a read-state table.
 *
 * The résumé review queue is the SECOND conversation to need all of that. Writing those
 * mechanics a second time is how a "one threading model" claim becomes three threading
 * models that agree until one of them forgets to bump the counter. So the mechanics live
 * here once, and both services own only the part that is actually theirs: who may talk to
 * whom, and what the conversation is about.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────
 * Authorisation. This module will open a thread between any refs you name and read any
 * thread whose tenant you name. Deciding WHO may do that is a domain rule with different
 * answers per feature (`DirectMessageService.mayReach` is superadmin ↔ sales associate;
 * a résumé review is any member of the workspace), and a primitive that tried to hold
 * both would end up holding a policy flag, which is the same drift wearing a parameter.
 *
 * Also not here: the live relay and notifications. Both are per-feature choices about
 * whose attention is worth spending, and both already have their own primitives.
 */

import { and, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { memberships, messages, objects, threads } from '../../infrastructure/database/schema';

/** A participant, in the kernel's terms — `memberships` holds people, agents and teams. */
export interface ThreadMember {
  memberKind: 'user' | 'agent' | 'team' | 'email';
  memberRef: string;
  role?: string;
}

export interface OpenThreadInput {
  tenantId: number;
  /** `threads.kind` — 'chat' | 'comment' | 'support' | 'ceremony' | 'dm' | 'agent' | … */
  kind: string;
  title: string | null;
  /** One of the roster domains — what the `objects` row files this under. */
  domain: string;
  /** The `objects.title` fallback, used when the thread itself is untitled. */
  objectTitle: string;
  mode?: 'chat' | 'work';
  status?: string;
  createdBy?: string | null;
  members: readonly ThreadMember[];
}

export interface OpenedThread {
  threadId: string;
  objectId: string;
}

/**
 * Open a conversation: the `threads` row, its `objects` registration, and its members.
 *
 * The `objects` row is not optional bookkeeping — `memberships.object_id` is NOT NULL, so
 * a thread with no object cannot have participants, which means it cannot have a read
 * cursor and cannot be listed for anyone. It is also the containment record the canvas
 * and the activity log read, so registering it here is what makes a new conversation kind
 * visible to surfaces nobody had to change.
 */
export async function openKernelThread(db: Db, input: OpenThreadInput): Promise<OpenedThread | null> {
  const [thread] = await db.insert(threads).values({
    tenantId: input.tenantId,
    kind: input.kind,
    title: input.title,
    mode: input.mode ?? 'chat',
    status: input.status ?? 'open',
    createdBy: input.createdBy ?? null,
  }).returning();
  if (!thread) return null;

  const title = input.title || input.objectTitle;
  const [object] = await db.insert(objects).values({
    tenantId: input.tenantId, kind: 'thread', refId: thread.id, domain: input.domain, title,
  }).onConflictDoUpdate({
    target: [objects.tenantId, objects.kind, objects.refId],
    set: { title, updatedAt: new Date() },
  }).returning();
  if (!object) return null;

  await addThreadMembers(db, input.tenantId, object.id, input.members);
  return { threadId: thread.id, objectId: object.id };
}

/** Add participants to a thread's object. Re-adding somebody is a no-op, not an error. */
export async function addThreadMembers(db: Db, tenantId: number, objectId: string, members: readonly ThreadMember[]): Promise<void> {
  if (members.length === 0) return;
  await db.insert(memberships).values(members.map((member) => ({
    tenantId,
    objectId,
    memberKind: member.memberKind,
    memberRef: member.memberRef,
    role: member.role ?? 'member',
    state: 'active',
    joinedAt: new Date(),
  }))).onConflictDoNothing({
    target: [memberships.tenantId, memberships.objectId, memberships.memberKind, memberships.memberRef],
  });
}

export interface KernelThreadRow {
  id: string;
  tenantId: number;
  kind: string;
  title: string;
  status: string;
}

/**
 * One thread row, within the tenants the caller may read.
 *
 * Returns the TENANT as well as the thread, because a caller holding only a person-level
 * token (a web JWT carries no tenant claim) needs the workspace the conversation was
 * filed under before it can write anything else against it.
 */
export async function getKernelThread(db: Db, tenantIds: readonly number[], threadId: string): Promise<KernelThreadRow | null> {
  if (tenantIds.length === 0) return null;
  const [row] = await db.select({
    id: threads.id, tenantId: threads.tenantId, kind: threads.kind,
    title: threads.title, status: threads.status,
  }).from(threads)
    .where(and(inArray(threads.tenantId, [...tenantIds]), eq(threads.id, threadId)))
    .limit(1);
  return row ? { ...row, title: row.title ?? '' } : null;
}

/** The `objects.id` a thread's memberships hang off, within the given tenants. */
export async function threadObjectId(db: Db, tenantIds: readonly number[], threadId: string): Promise<string | null> {
  if (tenantIds.length === 0) return null;
  const [row] = await db.select({ id: objects.id }).from(objects)
    .where(and(
      inArray(objects.tenantId, [...tenantIds]),
      eq(objects.kind, 'thread'),
      eq(objects.refId, threadId),
    )).limit(1);
  return row?.id ?? null;
}

/** Is this member an active participant of the thread? */
export async function isThreadParticipant(
  db: Db,
  tenantIds: readonly number[],
  threadId: string,
  memberRef: string,
  memberKind: ThreadMember['memberKind'] = 'user',
): Promise<boolean> {
  if (tenantIds.length === 0) return false;
  const [row] = await db.select({ id: memberships.id }).from(memberships)
    .innerJoin(objects, eq(objects.id, memberships.objectId))
    .where(and(
      inArray(memberships.tenantId, [...tenantIds]),
      eq(objects.kind, 'thread'), eq(objects.refId, threadId),
      eq(memberships.memberKind, memberKind), eq(memberships.memberRef, memberRef),
      eq(memberships.state, 'active'),
    )).limit(1);
  return row != null;
}

/** Every active participant ref on a thread — who to wake when something is said. */
export async function threadMemberRefs(db: Db, tenantId: number, threadId: string, memberKind: ThreadMember['memberKind'] = 'user'): Promise<string[]> {
  const rows = await db.select({ memberRef: memberships.memberRef }).from(memberships)
    .innerJoin(objects, eq(objects.id, memberships.objectId))
    .where(and(
      eq(memberships.tenantId, tenantId),
      eq(objects.kind, 'thread'), eq(objects.refId, threadId),
      eq(memberships.memberKind, memberKind), eq(memberships.state, 'active'),
    ));
  return rows.map((row) => row.memberRef);
}

/**
 * Thread ids this member participates in, most recently touched first.
 *
 * `memberships` is the kernel's presence table for EVERY object, so the rows have to be
 * narrowed to threads — a board membership is not a conversation.
 */
export async function memberThreadIds(
  db: Db,
  tenantIds: readonly number[],
  memberRef: string,
  limit: number,
  memberKind: ThreadMember['memberKind'] = 'user',
): Promise<string[]> {
  if (tenantIds.length === 0) return [];
  const rows = await db.select({ objectId: memberships.objectId, updatedAt: memberships.updatedAt })
    .from(memberships)
    .where(and(
      inArray(memberships.tenantId, [...tenantIds]),
      eq(memberships.memberKind, memberKind),
      eq(memberships.memberRef, memberRef),
      eq(memberships.state, 'active'),
    ))
    .orderBy(desc(memberships.updatedAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const objectRows = await db.select({ refId: objects.refId }).from(objects)
    .where(and(
      inArray(objects.tenantId, [...tenantIds]),
      inArray(objects.id, rows.map((row) => row.objectId)),
      eq(objects.kind, 'thread'),
    ));
  return objectRows.map((row) => row.refId);
}

/**
 * Every thread of one KIND in one workspace, most recently spoken in first.
 *
 * The counterpart to {@link memberThreadIds}: a direct message is only reachable by its
 * participants, but a QUEUE is reachable by anyone who could work it, and the difference
 * between those two access rules is exactly the kind of decision this module refuses to
 * make on a caller's behalf. Both return ids; the caller picks which question it is
 * asking and then renders them the same way.
 */
export async function tenantThreadIds(db: Db, tenantId: number, kind: string, limit: number): Promise<string[]> {
  const rows = await db.select({ id: threads.id }).from(threads)
    .where(and(eq(threads.tenantId, tenantId), eq(threads.kind, kind)))
    .orderBy(desc(threads.lastMessageAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

export interface ThreadMemberView {
  memberKind: string;
  memberRef: string;
  role: string;
  lastSeenAtISO: string | null;
}

export interface KernelThreadView {
  id: string;
  kind: string;
  title: string;
  status: string;
  lastMessageAtISO: string | null;
  messageCount: number;
  /** Messages since the reader's own cursor, by somebody other than the reader. */
  unread: number;
  members: ThreadMemberView[];
}

export interface ListThreadsInput {
  tenantIds: readonly number[];
  /** The thread ids to render — resolved by the caller's own access rule. */
  threadIds: readonly string[];
  /** Whose read cursor and whose authorship decide `unread`. */
  readerRef: string;
  limit: number;
  /** Narrow to one `threads.kind`, when the caller's surface owns exactly one. */
  kind?: string;
}

/**
 * Render thread rows with their members and the reader's unread count.
 *
 * Unread is counted in ONE grouped query rather than one COUNT per thread — the N+1 the
 * performance rule names. Each thread carries its own cursor, so the predicate is an OR
 * of per-thread clauses, bounded by the page size and still a single round trip.
 */
export async function listKernelThreads(db: Db, input: ListThreadsInput): Promise<KernelThreadView[]> {
  const tenantIds = [...input.tenantIds];
  const threadIds = [...input.threadIds];
  if (tenantIds.length === 0 || threadIds.length === 0) return [];

  const [threadRows, memberRows] = await Promise.all([
    db.select({
      id: threads.id, kind: threads.kind, title: threads.title, status: threads.status,
      lastMessageAt: threads.lastMessageAt, messageCount: threads.messageCount,
    }).from(threads)
      .where(and(
        inArray(threads.tenantId, tenantIds),
        inArray(threads.id, threadIds),
        ...(input.kind ? [eq(threads.kind, input.kind)] : []),
      ))
      .orderBy(desc(threads.lastMessageAt))
      .limit(input.limit),
    db.select({
      refId: objects.refId, memberKind: memberships.memberKind, memberRef: memberships.memberRef,
      role: memberships.role, lastSeenAt: memberships.lastSeenAt,
    }).from(memberships)
      .innerJoin(objects, eq(objects.id, memberships.objectId))
      .where(and(
        inArray(memberships.tenantId, tenantIds),
        eq(objects.kind, 'thread'), inArray(objects.refId, threadIds),
        eq(memberships.state, 'active'),
      )),
  ]);

  const membersByThread = new Map<string, ThreadMemberView[]>();
  const cursors = new Map<string, Date>();
  for (const row of memberRows) {
    const list = membersByThread.get(row.refId) ?? [];
    list.push({
      memberKind: row.memberKind,
      memberRef: row.memberRef,
      role: row.role,
      lastSeenAtISO: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    });
    membersByThread.set(row.refId, list);
    if (row.memberRef === input.readerRef) cursors.set(row.refId, row.lastSeenAt ?? new Date(0));
  }

  const clauses = threadRows.map((row) => and(
    eq(messages.threadId, row.id),
    gt(messages.createdAt, cursors.get(row.id) ?? new Date(0)),
  ));
  const unreadRows = clauses.length === 0 ? [] : await db
    .select({ threadId: messages.threadId, total: sql<string>`count(*)` })
    .from(messages)
    .where(and(inArray(messages.tenantId, tenantIds), ne(messages.authorRef, input.readerRef), or(...clauses)))
    .groupBy(messages.threadId);
  const unreadByThread = new Map(unreadRows.map((row) => [row.threadId, Number(row.total) || 0]));

  return threadRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title ?? '',
    status: row.status,
    lastMessageAtISO: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    messageCount: row.messageCount,
    unread: unreadByThread.get(row.id) ?? 0,
    members: membersByThread.get(row.id) ?? [],
  }));
}

export interface AppendMessageInput {
  tenantId: number;
  threadId: string;
  authorKind: 'user' | 'agent' | 'system';
  authorRef: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  body: string;
  /** Structured content — a grade, a rewrite set, an attachment list. */
  parts?: unknown;
}

export interface AppendedMessage {
  id: number;
  createdAtISO: string;
}

/**
 * Append a message and keep the thread's denormalised summary true.
 *
 * `messageCount` and `lastMessageAt` are denormalised on purpose (the kernel says so:
 * a thread list must not fan out one COUNT per row), which means every writer owes them
 * an update. Making that the primitive's job rather than each caller's is the reason this
 * function exists at all.
 */
export async function appendKernelMessage(db: Db, input: AppendMessageInput): Promise<AppendedMessage | null> {
  const [row] = await db.insert(messages).values({
    tenantId: input.tenantId,
    threadId: input.threadId,
    authorKind: input.authorKind,
    authorRef: input.authorRef,
    role: input.role,
    body: input.body,
    ...(input.parts === undefined ? {} : { parts: input.parts }),
  }).returning();
  if (!row) return null;

  const now = new Date();
  await db.update(threads)
    .set({ lastMessageAt: now, messageCount: sql`${threads.messageCount} + 1`, updatedAt: now })
    .where(and(eq(threads.tenantId, input.tenantId), eq(threads.id, input.threadId)));
  return { id: row.id, createdAtISO: row.createdAt.toISOString() };
}

export interface KernelMessageRow {
  id: number;
  threadId: string;
  authorKind: string;
  authorRef: string | null;
  role: string;
  body: string;
  parts: unknown;
  createdAtISO: string;
}

/** One conversation's messages, oldest first — a transcript reads downward. */
export async function listKernelMessages(db: Db, tenantIds: readonly number[], threadId: string, limit: number): Promise<KernelMessageRow[]> {
  if (tenantIds.length === 0) return [];
  const rows = await db.select({
    id: messages.id, threadId: messages.threadId, authorKind: messages.authorKind,
    authorRef: messages.authorRef, role: messages.role, body: messages.body,
    parts: messages.parts, createdAt: messages.createdAt,
  }).from(messages)
    .where(and(inArray(messages.tenantId, [...tenantIds]), eq(messages.threadId, threadId)))
    .orderBy(messages.createdAt)
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    authorKind: row.authorKind,
    authorRef: row.authorRef,
    role: row.role,
    body: row.body ?? '',
    parts: row.parts,
    createdAtISO: row.createdAt.toISOString(),
  }));
}

/**
 * Move a member's read cursor. `memberships.last_seen_at` IS the cursor — a separate
 * read-state table would be a second copy of presence.
 */
export async function markKernelThreadRead(
  db: Db,
  tenantIds: readonly number[],
  threadId: string,
  memberRef: string,
  at = new Date(),
): Promise<boolean> {
  const objectId = await threadObjectId(db, tenantIds, threadId);
  if (!objectId) return false;
  await db.update(memberships).set({ lastSeenAt: at, updatedAt: at })
    .where(and(
      inArray(memberships.tenantId, [...tenantIds]),
      eq(memberships.objectId, objectId),
      eq(memberships.memberKind, 'user'),
      eq(memberships.memberRef, memberRef),
    ));
  return true;
}

/** Move a thread's status. Returns the row's new status, or null when nothing matched. */
export async function setKernelThreadStatus(db: Db, tenantId: number, threadId: string, status: string): Promise<string | null> {
  const [row] = await db.update(threads)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(threads.tenantId, tenantId), eq(threads.id, threadId)))
    .returning({ status: threads.status });
  return row?.status ?? null;
}

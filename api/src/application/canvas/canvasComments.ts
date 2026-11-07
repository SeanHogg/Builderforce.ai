/**
 * Canvas COMMENTS as kernel `annotations` — the read/write surface the
 * creation-session routes call (PRD 39 §2 push 2, the MOVE phase).
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────────
 * Comments used to be five query statements inside `creationSessionRoutes.ts`, a god
 * route file, against a dedicated `creation_session_comments` table. `annotations`
 * was built to be the one store for "something a person said about something"
 * (PRD 20 §3.1), so the fold moves every read and write here and leaves the routes
 * thin. The WIRE shape is unchanged — `id` is still a uuid, `objectId` still names
 * the canvas object, `parentCommentId` still names the parent comment — so the
 * existing route tests run unmodified as the parity oracle (PRD 39 §2 "Done when").
 *
 * ── THE ID MAP ───────────────────────────────────────────────────────────────────
 * The kernel annotation row is keyed by a bigserial `id`; the wire comment id is the
 * `public_id` uuid minted at fold (migration 1298). Every read projects
 * `public_id AS id`. Threading rides `parent_id` (bigserial), so a read that must
 * return the parent's WIRE id resolves it with one extra query over the session's
 * own comments and maps it in JS — a self-join on `annotations` has no Drizzle
 * helper in this codebase and two small queries are clearer than raw SQL.
 *
 * ── THE PIN ──────────────────────────────────────────────────────────────────────
 * The old table's `object_id` FK was ON DELETE SET NULL. `annotations` has no such
 * FK (the pin lives in `anchor.canvasObjectId` by design, PRD 39 §2 decision), so
 * the SET NULL obligation moves into the domain layer: `clearCommentPins` is called
 * where a canvas object is deleted.
 *
 * ── THE BODY CHECK ───────────────────────────────────────────────────────────────
 * The 1–5,000 character CHECK that used to be migration 0388's table constraint now
 * lives here, at the single write path, exactly where the PRD §2 mapping puts it.
 */

import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { annotations, users } from '../../infrastructure/database/schema';
import { ensureSessionObject, type SessionRef } from '../creation/sessionObjectRef';
import type { SessionKey } from '../creation/sessionMembers';

/** The comment row shape the API has always returned — the parity contract. */
export interface CanvasComment {
  id: string;
  objectId: string | null;
  parentCommentId: string | null;
  body: string;
  mentions: unknown;
  anchor: unknown;
  createdBy: string | null;
  authorName: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The slimmer activity-feed projection (comments merged with events by the route). */
export interface CanvasCommentActivity {
  id: string;
  objectId: string | null;
  body: string;
  actorRef: string | null;
  actorName: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** The 1–5,000 character body rule, moved off migration 0388's table CHECK (PRD 39 §2). */
export const COMMENT_BODY_MIN = 1;
export const COMMENT_BODY_MAX = 5_000;
export function isValidCommentBody(body: string): boolean {
  return body.length >= COMMENT_BODY_MIN && body.length <= COMMENT_BODY_MAX;
}

/** The pin lives here on the folded rows (PRD 39 §2 mapping: object_id → anchor.canvasObjectId). */
const PIN_KEY = 'canvasObjectId';

const COMMENT_ROW = {
  id: annotations.publicId,
  parentId: annotations.parentId,
  body: annotations.body,
  mentions: annotations.mentions,
  anchor: annotations.anchor,
  createdBy: annotations.authorRef,
  authorName: users.displayName,
  resolvedAt: annotations.resolvedAt,
  resolvedBy: annotations.resolvedBy,
  createdAt: annotations.createdAt,
  updatedAt: annotations.updatedAt,
};

/** Every comment of one session: the session-scoped, kind-scoped, not-deleted predicate. */
function onSession(session: SessionKey): SQL {
  return and(
    eq(annotations.tenantId, session.tenantId),
    // The session's registry object, kind 'creation_session' (sessionObjectRef.ts).
    sql`${annotations.objectId} = (select id from objects
          where tenant_id = ${session.tenantId}
            and kind = 'creation_session'
            and ref_id = ${session.id}
          limit 1)`,
    eq(annotations.kind, 'comment'),
    isNull(annotations.deletedAt),
  )!;
}

/** Wire ids of this session's comments keyed by bigserial id — the parent-id map. */
async function commentIdMap(db: Db, session: SessionKey): Promise<Map<number, string>> {
  const rows = await db.select({ id: annotations.id, publicId: annotations.publicId })
    .from(annotations)
    .where(onSession(session));
  return new Map(rows.map((row) => [row.id, row.publicId]));
}

type RawCommentRow = {
  id: string; parentId: number | null; body: string; mentions: unknown; anchor: unknown;
  createdBy: string | null; authorName: string | null;
  resolvedAt: Date | null; resolvedBy: string | null; createdAt: Date; updatedAt: Date;
};

function pinOf(anchor: unknown): string | null {
  if (anchor && typeof anchor === 'object' && !Array.isArray(anchor)) {
    const pin = (anchor as Record<string, unknown>)[PIN_KEY];
    return typeof pin === 'string' ? pin : null;
  }
  return null;
}

function toComment(row: RawCommentRow, parentIds: Map<number, string>): CanvasComment {
  return {
    id: row.id,
    objectId: pinOf(row.anchor),
    parentCommentId: row.parentId === null ? null : (parentIds.get(row.parentId) ?? null),
    body: row.body,
    mentions: row.mentions,
    anchor: row.anchor,
    createdBy: row.createdBy,
    authorName: row.authorName,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function selectComment(db: Db, session: SessionKey, annotationId: number): Promise<CanvasComment | null> {
  const [row] = await db.select(COMMENT_ROW).from(annotations)
    .leftJoin(users, eq(users.id, annotations.authorRef))
    .where(and(eq(annotations.id, annotationId), onSession(session)))
    .limit(1) as unknown as RawCommentRow[];
  if (!row) return null;
  const parentIds = row.parentId === null ? new Map<number, string>() : await commentIdMap(db, session);
  return toComment(row, parentIds);
}

/** Every comment on a board, newest first, optionally filtered to one pinned object. */
export async function listComments(db: Db, session: SessionKey, objectId?: string | null): Promise<CanvasComment[]> {
  const where = and(
    onSession(session),
    objectId ? sql`${annotations.anchor}->>'${sql.raw(PIN_KEY)}' = ${objectId}` : undefined,
  )!;
  const rows = await db.select(COMMENT_ROW).from(annotations)
    .leftJoin(users, eq(users.id, annotations.authorRef))
    .where(where)
    .orderBy(desc(annotations.createdAt))
    .limit(200) as unknown as RawCommentRow[];
  if (rows.length === 0) return [];
  const parentIds = await commentIdMap(db, session);
  return rows.map((row) => toComment(row, parentIds));
}

/** The activity feed's comment half — id/objectId/body/actor/resolvedAt/createdAt. */
export async function listCommentActivity(db: Db, session: SessionKey, limit: number): Promise<CanvasCommentActivity[]> {
  const rows = await db.select(COMMENT_ROW).from(annotations)
    .leftJoin(users, eq(users.id, annotations.authorRef))
    .where(onSession(session))
    .orderBy(desc(annotations.createdAt))
    .limit(limit) as unknown as RawCommentRow[];
  if (rows.length === 0) return [];
  const parentIds = await commentIdMap(db, session);
  return rows.map((row) => {
    const comment = toComment(row, parentIds);
    return {
      id: comment.id,
      objectId: comment.objectId,
      body: comment.body,
      actorRef: comment.createdBy,
      actorName: comment.authorName,
      resolvedAt: comment.resolvedAt,
      createdAt: comment.createdAt,
    };
  });
}

/** A parent comment's author, for the reply notification. Null when not a comment here. */
export async function findCommentCreator(db: Db, session: SessionKey, commentPublicId: string): Promise<string | null> {
  const [row] = await db.select({ authorRef: annotations.authorRef }).from(annotations)
    .where(and(eq(annotations.publicId, commentPublicId), onSession(session)))
    .limit(1);
  return row?.authorRef ?? null;
}

export class ParentCommentNotFoundError extends Error {}

export interface CreateCommentInput {
  objectId: string | null;
  parentCommentId: string | null;
  body: string;
  mentions: string[];
  anchor: Record<string, unknown> | null;
  createdBy: string;
}

/**
 * Insert a comment as an `annotations` row. The session's registry object is
 * ensured first (the same upsert the invite path uses) so the NOT NULL `object_id`
 * always has a home. Returns the wire-shaped row the POST route has always returned.
 */
export async function createComment(db: Db, env: Env | undefined, session: SessionRef, input: CreateCommentInput): Promise<CanvasComment> {
  if (!isValidCommentBody(input.body)) throw new Error('comment body out of range');
  const object = await ensureSessionObject(db, env, session);
  let parentId: number | null = null;
  if (input.parentCommentId) {
    const [parent] = await db.select({ id: annotations.id }).from(annotations)
      .where(and(eq(annotations.publicId, input.parentCommentId), onSession(session)))
      .limit(1);
    if (!parent) throw new ParentCommentNotFoundError(input.parentCommentId);
    parentId = parent.id;
  }
  const anchor: Record<string, unknown> = input.anchor ? { ...input.anchor } : {};
  if (input.objectId) anchor[PIN_KEY] = input.objectId;
  const [created] = await db.insert(annotations).values({
    tenantId: session.tenantId,
    objectId: object.id,
    kind: 'comment',
    parentId,
    authorKind: 'user',
    authorRef: input.createdBy,
    body: input.body,
    mentions: input.mentions,
    anchor: Object.keys(anchor).length ? anchor : null,
  }).returning({ id: annotations.id });
  return selectComment(db, session, created.id) as Promise<CanvasComment>;
}

/** Mark a comment resolved/unresolved. Returns the updated wire row, or null when absent. */
export async function setCommentResolved(
  db: Db, session: SessionKey, commentPublicId: string, resolved: boolean, userId: string,
): Promise<CanvasComment | null> {
  const target = await db.update(annotations).set({
    resolvedAt: resolved ? new Date() : null,
    resolvedBy: resolved ? userId : null,
    updatedAt: new Date(),
  }).where(and(eq(annotations.publicId, commentPublicId), onSession(session)))
    .returning({ id: annotations.id });
  if (target.length === 0) return null;
  return selectComment(db, session, target[0].id);
}

/**
 * Clear the pin on every comment anchored to a deleted canvas object. This replaces
 * the old table's ON DELETE SET NULL (PRD 39 §2: the pin lives in
 * `anchor.canvasObjectId`, which has no FK), so it MUST run where a canvas object is
 * deleted.
 */
export async function clearCommentPins(db: Db, session: SessionKey, canvasObjectId: string): Promise<void> {
  await db.update(annotations)
    .set({ anchor: sql`${annotations.anchor} - '${sql.raw(PIN_KEY)}'::text`, updatedAt: new Date() })
    .where(and(
      onSession(session),
      sql`${annotations.anchor}->>'${sql.raw(PIN_KEY)}' = ${canvasObjectId}`,
    ));
}

/** Hard-delete a board's folded comments (annotations on its registry object). */
export async function deleteSessionComments(db: Db, session: SessionKey): Promise<void> {
  await db.delete(annotations).where(onSession(session));
}

/** Drop annotations whose registry object is gone (an orphan sweep for the fold). */
export async function deleteOrphanAnnotations(db: Db): Promise<number> {
  const result = await db.execute(sql`
    delete from annotations
     where object_id not in (select id from objects)
     returning id`);
  return Array.isArray(result) ? result.length : 0;
}

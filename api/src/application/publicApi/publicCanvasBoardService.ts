/**
 * The `/api/v1` public canvas board — tenant-scoped board reads, whole-graph
 * item writes, and the realtime/webhook fan-out a commit triggers.
 *
 * Extracted from the route so `presentation/routes/publicCanvasApiRoutes.ts` stays a
 * thin HTTP adapter: it parses the request, calls one of these, and turns the result
 * into a response. Every query here is tenant-scoped the same way every other
 * application service scopes one — see `scopedToTenant` — so a public API key can
 * never read or mutate another tenant's board by guessing an id.
 */

import { desc, eq, sql } from 'drizzle-orm';
import { CANVAS_WIDGET_RESOURCE_TYPE } from '@builderforce/canvas-widget-protocol';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  canvasWidgets,
  creationSessionConnections,
  creationSessionObjects,
  creationSessions,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  bumpPublicCanvasVersion,
  getCacheVersion,
  getOrSetCached,
  publicCanvasVersionKey,
} from '../../infrastructure/cache/readThroughCache';
import { broadcastRoom, creationSessionRoomName } from '../../infrastructure/relay/broadcastRoom';
import {
  creationGraphStatements,
  CREATION_UUID_RE as UUID_RE,
  type GraphConnectionInput,
  type GraphObjectInput,
} from '../creation/creationGraphWriter';
import { emitWebhookEvent, type WebhookEvent } from '../seams/webhookService';

export type PublicBoardRow = typeof creationSessions.$inferSelect;

/** The public shape of a board. Deliberately narrower than the row: `preview`,
 *  `folder` and the branch pointers are in-product concerns an integrator has no
 *  contract for, and a field returned once is a field that can never be removed. */
export function publicBoardView(row: PublicBoardRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    revision: row.canvasRevision,
    viewport: row.viewport,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

export function publicItemView(object: GraphObjectInput) {
  return {
    id: object.id,
    kind: object.kind,
    geometry: object.canvasData ?? {},
    content: object.content ?? null,
    resourceType: object.resourceType ?? null,
    resourceId: object.resourceId ?? null,
  };
}

/**
 * Resolve a board WITHIN the caller's tenant, or `null`.
 *
 * The tenant predicate is on the query, not a comparison afterwards, and that is
 * the whole cross-tenant defence: a key from tenant A asking for a board belonging
 * to tenant B gets no row, and therefore the same "not found" as a board id that
 * never existed. A 403 there would confirm the board exists, which turns the
 * endpoint into an enumeration oracle for other customers' board ids.
 */
export async function findPublicBoard(
  db: Db,
  tenantId: number,
  boardId: string,
): Promise<PublicBoardRow | null> {
  if (!UUID_RE.test(boardId)) return null;
  const [board] = await db
    .select()
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, tenantId, eq(creationSessions.id, boardId)))
    .limit(1);
  if (!board || board.status === 'deleted') return null;
  return board;
}

export interface PublicBoardListPage {
  boards: ReturnType<typeof publicBoardView>[];
  total: number;
  page: number;
  limit: number;
}

/** GET /api/v1/boards — every board the tenant owns, cached under the tenant's
 *  canvas version token so any board write anywhere invalidates every page. */
export async function listPublicBoards(
  db: Db,
  env: Env,
  tenantId: number,
  opts: { page: number; limit: number; status: 'active' | 'archived' | null },
): Promise<PublicBoardListPage> {
  const { page, limit, status } = opts;
  const version = await getCacheVersion(env, publicCanvasVersionKey(tenantId));
  return getOrSetCached(
    env,
    `v1:canvas:boards:${tenantId}:${status ?? 'all'}:${page}:${limit}:v:${version}`,
    async () => {
      const where = scopedToTenant(
        creationSessions, tenantId,
        status ? eq(creationSessions.status, status) : sql`${creationSessions.status} <> 'deleted'`,
      );
      const [rows, [countRow]] = await Promise.all([
        db.select().from(creationSessions).where(where)
          .orderBy(desc(creationSessions.lastActivityAt))
          .limit(limit).offset((page - 1) * limit),
        db.select({ count: sql<number>`count(*)::int` }).from(creationSessions).where(where),
      ]);
      return {
        boards: rows.map(publicBoardView),
        total: Number(countRow?.count ?? 0),
        page,
        limit,
      };
    },
  );
}

export interface PublicBoardGraph {
  objects: GraphObjectInput[];
  connections: GraphConnectionInput[];
}

/** Read the whole graph once. Keyed on the revision, so it self-invalidates. */
export async function readPublicBoardGraph(db: Db, env: Env, board: PublicBoardRow): Promise<PublicBoardGraph> {
  return getOrSetCached(
    env,
    `v1:canvas:board:${board.id}:rev:${board.canvasRevision}`,
    async () => {
      const [objects, connections] = await Promise.all([
        db.select().from(creationSessionObjects)
          .where(eq(creationSessionObjects.sessionId, board.id))
          .orderBy(creationSessionObjects.createdAt),
        db.select().from(creationSessionConnections)
          .where(eq(creationSessionConnections.sessionId, board.id)),
      ]);
      return {
        objects: objects.map((o): GraphObjectInput => ({
          id: o.id, kind: o.kind, resourceType: o.resourceType, resourceId: o.resourceId,
          resourceRevision: o.resourceRevision, canvasData: o.canvasData, content: o.content,
        })),
        connections: connections.map((e): GraphConnectionInput => ({
          id: e.id, sourceObjectId: e.sourceObjectId, targetObjectId: e.targetObjectId,
          kind: e.kind, label: e.label, metadata: e.metadata,
        })),
      };
    },
  );
}

/**
 * A widget placement must point at a widget this tenant actually registered.
 *
 * Without this an integrator could place an object claiming
 * `resourceType: 'canvas_widget'` with any `resourceId`, and the browser host
 * would then look up an origin for it — the one place a forged resource pointer
 * turns into "which origin do we trust for this frame".
 */
export async function publicWidgetRefsValid(
  db: Db,
  objects: GraphObjectInput[],
  tenantId: number,
): Promise<string | null> {
  const ids = [...new Set(objects
    .filter((o) => o.resourceType === CANVAS_WIDGET_RESOURCE_TYPE && o.resourceId)
    .map((o) => o.resourceId as string))];
  if (!ids.length) return null;
  if (ids.some((id) => !UUID_RE.test(id))) return 'A widget reference is invalid';
  const rows = await db
    .select({ id: canvasWidgets.id })
    .from(canvasWidgets)
    .where(scopedToTenant(canvasWidgets, tenantId, eq(canvasWidgets.status, 'active')));
  const known = new Set(rows.map((r) => r.id));
  return ids.every((id) => known.has(id)) ? null : 'A widget is not registered in this workspace, or is disabled';
}

/**
 * Persist a mutated graph at revision+1 and tell everyone who is listening.
 *
 * `eventId` is `<boardId>.<revision>.<objectId>` — the board's revision is
 * monotonic, so the same logical change can never mint two ids, and two different
 * changes can never mint one. That is what makes the delivery unique index a real
 * replay guard rather than a hopeful one.
 *
 * `waitUntil` is the caller's execution-context hook, not threaded through as a
 * whole request context: this module has no business knowing about Hono.
 */
export async function commitPublicBoardGraph(
  db: Db,
  env: Env,
  waitUntil: (p: Promise<unknown>) => void,
  board: PublicBoardRow,
  auth: { keyId: string; tenantId: number },
  objects: GraphObjectInput[],
  connections: GraphConnectionInput[],
  event: { type: WebhookEvent; objectId: string; data: Record<string, unknown> },
  idempotencyKey: string | null,
): Promise<number> {
  const revision = board.canvasRevision + 1;
  const statements = creationGraphStatements(db, {
    sessionId: board.id,
    tenantId: board.tenantId,
    objects, connections,
    revision,
    // A key is not a person. `authorUserId` stays null so `created_by` never
    // names a user who did not do this.
    actorType: 'api', actorRef: `key:${auth.keyId}`, authorUserId: null,
    eventType: event.type,
    eventPayload: { objectId: event.objectId, keyId: auth.keyId },
    idempotencyKey,
    viewport: board.viewport,
    // A public caller that retries the same request must not be handed a 500 by
    // its own retry; the revision conflict below is what tells it to re-read.
    snapshotOnConflictDoNothing: true,
  });
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  waitUntil(Promise.all([
    broadcastRoom(
      env?.SESSION_ROOM,
      creationSessionRoomName(board.tenantId, board.id),
      JSON.stringify({ type: 'canvas.changed', revision }),
    ),
    bumpPublicCanvasVersion(env, board.tenantId),
    emitWebhookEvent(db, {
      tenantId: board.tenantId,
      segmentId: board.segmentId,
      sessionId: board.id,
      eventType: event.type,
      eventId: `${board.id}.${revision}.${event.objectId}`,
      data: { boardId: board.id, revision, ...event.data },
    }),
  ]).then(() => undefined));

  return revision;
}

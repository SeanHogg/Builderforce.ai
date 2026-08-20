/**
 * The PUBLIC canvas API — board and item CRUD over `creation_sessions`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * `/api/v1` was read-only catalog listings. Miro has board and item CRUD, webhooks
 * and a widget SDK, and that is how it reached 250+ integrations without building
 * them: the integrations were written by other people, against an API that let them
 * put things ON the board. A canvas nobody else can write to is a canvas that only
 * ever holds what we shipped.
 *
 * ── WHAT AN ITEM IS, AND WHAT IT IS NOT ──────────────────────────────────────────
 * An item is one `creation_session_objects` row. It is NOT a new noun: the canvas
 * already has objects with a kind, geometry, content and an optional pointer at a
 * canonical resource, and every export, preview, search projection and realtime
 * subscriber already understands them. A parallel "public item" model would be a
 * second canvas that has to be kept in step with the first.
 *
 * Which means the validation is not this module's to invent either. `kind` goes
 * through `isCreationObjectKind` and the resulting graph through
 * `validCreationGraph` — the same two the in-product save path uses — so an object
 * an integrator can create is exactly an object the canvas can render. Writing a
 * second validator here is how `/api/v1` would start accepting a kind the editor
 * refuses to draw.
 *
 * ── WHY A WRITE IS A WHOLE-GRAPH WRITE ───────────────────────────────────────────
 * A board is versioned as a unit (`canvas_revision`), and its history, its
 * snapshots and its realtime protocol are all keyed on that revision. So "create
 * one item" is read-graph → mutate-in-memory → write-graph at revision+1, exactly
 * as `POST /:id/commands` does, through the same `creationGraphStatements`
 * primitive. An item-level UPDATE statement would be cheaper and would silently
 * desynchronise every collaborator's cursor, every snapshot and the undo history.
 *
 * ── CACHING ──────────────────────────────────────────────────────────────────────
 * The item read folds the board's own `canvas_revision` into the cache key, so it
 * is exact rather than eventually-correct: every write bumps the revision, which
 * orphans the key, and no writer anywhere has to remember to invalidate anything.
 * The board LISTING cannot do that (it spans boards), so it uses the shared
 * `publicCanvasVersionKey` token that the in-product canvas writes bump too.
 */

import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { isCreationObjectKind } from '@builderforce/creation-canvas-contract';
import { CANVAS_WIDGET_RESOURCE_TYPE } from '@builderforce/canvas-widget-protocol';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
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
  validCreationGraph,
  type GraphConnectionInput,
  type GraphObjectInput,
} from '../creation/creationGraphWriter';
import { emitWebhookEvent, type WebhookEvent } from '../seams/webhookService';
import { requirePublicApiKey, type PublicApiContext } from './publicApiAuth';
import { touchTenantApiKey } from '../llm/tenantApiKeyService';


interface ItemBody {
  id?: string;
  kind?: string;
  geometry?: unknown;
  content?: unknown;
  resourceType?: string | null;
  resourceId?: string | null;
}

/** The public shape of a board. Deliberately narrower than the row: `preview`,
 *  `folder` and the branch pointers are in-product concerns an integrator has no
 *  contract for, and a field returned once is a field that can never be removed. */
function boardView(row: typeof creationSessions.$inferSelect) {
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

function itemView(object: GraphObjectInput) {
  return {
    id: object.id,
    kind: object.kind,
    geometry: object.canvasData ?? {},
    content: object.content ?? null,
    resourceType: object.resourceType ?? null,
    resourceId: object.resourceId ?? null,
  };
}

export function createPublicCanvasRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * Resolve the key, then resolve the board WITHIN that key's tenant.
   *
   * The tenant predicate is on the board query, not a comparison afterwards, and
   * that is the whole cross-tenant defence: a key from tenant A asking for a board
   * belonging to tenant B gets no row, and therefore the same 404 as a board id
   * that never existed. Answering 403 there would confirm the board exists, which
   * turns the endpoint into an enumeration oracle for other customers' board ids.
   */
  async function resolveBoard(
    c: PublicApiContext,
    boardId: string,
    scope: 'read:canvas' | 'write:canvas',
  ) {
    const auth = await requirePublicApiKey(
      db, c.req.header('Authorization'), c.req.header('Origin') ?? null, scope,
    );
    if (!auth.ok) return { error: c.json({ error: auth.error }, auth.status) };
    c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));

    if (!UUID_RE.test(boardId)) return { error: c.json({ error: 'Board not found' }, 404) };
    const [board] = await db
      .select()
      .from(creationSessions)
      .where(scopedToTenant(creationSessions, auth.tenantId, eq(creationSessions.id, boardId)))
      .limit(1);
    if (!board || board.status === 'deleted') return { error: c.json({ error: 'Board not found' }, 404) };
    return { auth, board };
  }

  /** Read the whole graph once. Keyed on the revision, so it self-invalidates. */
  async function readGraph(c: { env: HonoEnv['Bindings'] }, board: typeof creationSessions.$inferSelect) {
    return getOrSetCached(
      c.env,
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
  async function widgetRefValid(objects: GraphObjectInput[], tenantId: number): Promise<string | null> {
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
   */
  async function commitGraph(
    c: { env: HonoEnv['Bindings']; executionCtx: { waitUntil(p: Promise<unknown>): void } },
    board: typeof creationSessions.$inferSelect,
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

    c.executionCtx.waitUntil(Promise.all([
      broadcastRoom(
        c.env?.SESSION_ROOM,
        creationSessionRoomName(board.tenantId, board.id),
        JSON.stringify({ type: 'canvas.changed', revision }),
      ),
      bumpPublicCanvasVersion(c.env, board.tenantId),
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

  // ── Boards ────────────────────────────────────────────────────────────────

  /** GET /api/v1/boards — every board the key's tenant owns. */
  router.get('/boards', async (c) => {
    const auth = await requirePublicApiKey(
      db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'read:canvas',
    );
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));

    const { page = '1', limit = '25', status = 'active' } = c.req.query();
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 25));
    const wanted = status === 'all' ? null : (status === 'archived' ? 'archived' : 'active');

    const version = await getCacheVersion(c.env, publicCanvasVersionKey(auth.tenantId));
    const body = await getOrSetCached(
      c.env,
      `v1:canvas:boards:${auth.tenantId}:${wanted ?? 'all'}:${pageNum}:${limitNum}:v:${version}`,
      async () => {
        const where = scopedToTenant(
          creationSessions, auth.tenantId,
          wanted ? eq(creationSessions.status, wanted) : sql`${creationSessions.status} <> 'deleted'`,
        );
        const [rows, [countRow]] = await Promise.all([
          db.select().from(creationSessions).where(where)
            .orderBy(desc(creationSessions.lastActivityAt))
            .limit(limitNum).offset((pageNum - 1) * limitNum),
          db.select({ count: sql<number>`count(*)::int` }).from(creationSessions).where(where),
        ]);
        return {
          boards: rows.map(boardView),
          total: Number(countRow?.count ?? 0),
          page: pageNum,
          limit: limitNum,
        };
      },
    );
    return c.json(body);
  });

  /** GET /api/v1/boards/:boardId */
  router.get('/boards/:boardId', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'read:canvas');
    if ('error' in resolved) return resolved.error;
    return c.json({ board: boardView(resolved.board) });
  });

  // ── Items ─────────────────────────────────────────────────────────────────

  /** GET /api/v1/boards/:boardId/items */
  router.get('/boards/:boardId/items', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'read:canvas');
    if ('error' in resolved) return resolved.error;
    const graph = await readGraph(c, resolved.board);
    const kind = c.req.query('kind');
    const items = kind ? graph.objects.filter((o) => o.kind === kind) : graph.objects;
    return c.json({
      boardId: resolved.board.id,
      revision: resolved.board.canvasRevision,
      items: items.map(itemView),
      total: items.length,
    });
  });

  /** GET /api/v1/boards/:boardId/items/:itemId */
  router.get('/boards/:boardId/items/:itemId', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'read:canvas');
    if ('error' in resolved) return resolved.error;
    const graph = await readGraph(c, resolved.board);
    const item = graph.objects.find((o) => o.id.toLowerCase() === c.req.param('itemId').toLowerCase());
    if (!item) return c.json({ error: 'Item not found' }, 404);
    return c.json({ boardId: resolved.board.id, revision: resolved.board.canvasRevision, item: itemView(item) });
  });

  /** POST /api/v1/boards/:boardId/items — create one object. */
  router.post('/boards/:boardId/items', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'write:canvas');
    if ('error' in resolved) return resolved.error;
    const { board, auth } = resolved;

    const body = await c.req.json<ItemBody>().catch(() => ({} as ItemBody));
    const kind = typeof body.kind === 'string' ? body.kind.slice(0, 48) : '';
    // NOT a second validator: the same predicate the in-product save path uses.
    if (!isCreationObjectKind(kind)) {
      return c.json({ error: `Unsupported item kind: ${kind || 'missing'}`, code: 'UNSUPPORTED_KIND' }, 400);
    }
    const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : crypto.randomUUID();

    const graph = await readGraph(c, board);
    if (graph.objects.some((o) => o.id.toLowerCase() === id.toLowerCase())) {
      return c.json({ error: 'An item with that id already exists', code: 'ITEM_EXISTS' }, 409);
    }
    const item: GraphObjectInput = {
      id, kind,
      resourceType: typeof body.resourceType === 'string' ? body.resourceType.slice(0, 64) : null,
      resourceId: body.resourceId == null ? null : String(body.resourceId).slice(0, 128),
      canvasData: body.geometry && typeof body.geometry === 'object' ? body.geometry : {},
      content: body.content && typeof body.content === 'object' ? body.content : { kind, title: kind },
    };
    const objects = [...graph.objects, item];

    const graphError = validCreationGraph(objects, graph.connections);
    if (graphError) return c.json({ error: graphError }, 400);
    const widgetError = await widgetRefValid([item], board.tenantId);
    if (widgetError) return c.json({ error: widgetError, code: 'WIDGET_NOT_REGISTERED' }, 400);

    const revision = await commitGraph(
      c, board, auth, objects, graph.connections,
      { type: 'canvas.item.created', objectId: id, data: { item: itemView(item) } },
      c.req.header('Idempotency-Key')?.slice(0, 128) || null,
    );
    return c.json({ boardId: board.id, revision, item: itemView(item) }, 201);
  });

  /** PATCH /api/v1/boards/:boardId/items/:itemId — merge geometry and/or content. */
  router.patch('/boards/:boardId/items/:itemId', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'write:canvas');
    if ('error' in resolved) return resolved.error;
    const { board, auth } = resolved;

    const body = await c.req.json<ItemBody>().catch(() => ({} as ItemBody));
    const graph = await readGraph(c, board);
    const itemId = c.req.param('itemId');
    const index = graph.objects.findIndex((o) => o.id.toLowerCase() === itemId.toLowerCase());
    if (index < 0) return c.json({ error: 'Item not found' }, 404);

    const current = graph.objects[index]!;
    // A patch MERGES, and the geometry/content split is why: an integrator moving a
    // card must not have to resend its body, and one editing its body must not have
    // to know where a person just dragged it.
    const updated: GraphObjectInput = {
      ...current,
      canvasData: body.geometry && typeof body.geometry === 'object'
        ? { ...(current.canvasData as object ?? {}), ...(body.geometry as object) }
        : current.canvasData,
      content: body.content && typeof body.content === 'object'
        ? { ...(current.content as object ?? {}), ...(body.content as object) }
        : current.content,
    };
    const objects = [...graph.objects];
    objects[index] = updated;

    const graphError = validCreationGraph(objects, graph.connections);
    if (graphError) return c.json({ error: graphError }, 400);

    const revision = await commitGraph(
      c, board, auth, objects, graph.connections,
      { type: 'canvas.item.updated', objectId: updated.id, data: { item: itemView(updated) } },
      c.req.header('Idempotency-Key')?.slice(0, 128) || null,
    );
    return c.json({ boardId: board.id, revision, item: itemView(updated) });
  });

  /** DELETE /api/v1/boards/:boardId/items/:itemId */
  router.delete('/boards/:boardId/items/:itemId', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'write:canvas');
    if ('error' in resolved) return resolved.error;
    const { board, auth } = resolved;

    const graph = await readGraph(c, board);
    const itemId = c.req.param('itemId');
    const item = graph.objects.find((o) => o.id.toLowerCase() === itemId.toLowerCase());
    if (!item) return c.json({ error: 'Item not found' }, 404);

    const objects = graph.objects.filter((o) => o.id !== item.id);
    // Edges pointing at a removed object are removed with it — the graph validator
    // would reject the write otherwise, and the alternative (refusing to delete a
    // connected item) makes an integration unable to clean up after itself.
    const connections = graph.connections.filter(
      (e) => e.sourceObjectId !== item.id && e.targetObjectId !== item.id,
    );

    const revision = await commitGraph(
      c, board, auth, objects, connections,
      { type: 'canvas.item.deleted', objectId: item.id, data: { itemId: item.id, kind: item.kind } },
      c.req.header('Idempotency-Key')?.slice(0, 128) || null,
    );
    return c.json({ boardId: board.id, revision, deleted: item.id });
  });

  return router;
}

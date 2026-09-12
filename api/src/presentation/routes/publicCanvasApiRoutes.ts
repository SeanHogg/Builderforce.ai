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
import { isCreationObjectKind } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import {
  CREATION_UUID_RE as UUID_RE,
  validCreationGraph,
  type GraphObjectInput,
} from '../../application/creation/creationGraphWriter';
import {
  commitPublicBoardGraph,
  findPublicBoard,
  listPublicBoards,
  publicItemView,
  publicBoardView,
  publicWidgetRefsValid,
  readPublicBoardGraph,
  type PublicBoardRow,
} from '../../application/publicApi/publicCanvasBoardService';
import { requirePublicApiKey, type PublicApiContext } from '../../application/publicApi/publicApiAuth';
import { touchTenantApiKey } from '../../application/llm/tenantApiKeyService';
import { parseOptionalBody, z } from './requestBody';


/**
 * An item write. Every field is optional — the create handler owns "missing kind"
 * (`UNSUPPORTED_KIND`) and a patch merges only what it names — but a field that IS
 * sent must be the right type, so `{ "kind": 7 }` is a 400 naming `kind`.
 */
const ItemBodySchema = z.object({
  id: z.string().optional(),
  kind: z.string().optional(),
  geometry: z.unknown().optional(),
  content: z.unknown().optional(),
  resourceType: z.string().nullable().optional(),
  resourceId: z.union([z.string(), z.number()]).nullable().optional(),
});

export function createPublicCanvasRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * Resolve the key, then resolve the board WITHIN that key's tenant. The tenant
   * predicate lives in `findPublicBoard`'s query, not a comparison afterwards —
   * see that function for why a foreign board id gets the same 404 as one that
   * never existed at all.
   */
  async function resolveBoard(
    c: PublicApiContext,
    boardId: string,
    scope: 'read:canvas' | 'write:canvas',
  ): Promise<{ error: Response } | { auth: { keyId: string; tenantId: number }; board: PublicBoardRow }> {
    const auth = await requirePublicApiKey(
      db, c.req.header('Authorization'), c.req.header('Origin') ?? null, scope,
    );
    if (!auth.ok) return { error: c.json({ error: auth.error }, auth.status) };
    c.executionCtx.waitUntil(touchTenantApiKey(db, auth.keyId));

    const board = await findPublicBoard(db, auth.tenantId, boardId);
    if (!board) return { error: c.json({ error: 'Board not found' }, 404) };
    return { auth, board };
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

    const body = await listPublicBoards(db, c.env, auth.tenantId, { page: pageNum, limit: limitNum, status: wanted });
    return c.json(body);
  });

  /** GET /api/v1/boards/:boardId */
  router.get('/boards/:boardId', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'read:canvas');
    if ('error' in resolved) return resolved.error;
    return c.json({ board: publicBoardView(resolved.board) });
  });

  // ── Items ─────────────────────────────────────────────────────────────────

  /** GET /api/v1/boards/:boardId/items */
  router.get('/boards/:boardId/items', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'read:canvas');
    if ('error' in resolved) return resolved.error;
    const graph = await readPublicBoardGraph(db, c.env, resolved.board);
    const kind = c.req.query('kind');
    const items = kind ? graph.objects.filter((o) => o.kind === kind) : graph.objects;
    return c.json({
      boardId: resolved.board.id,
      revision: resolved.board.canvasRevision,
      items: items.map(publicItemView),
      total: items.length,
    });
  });

  /** GET /api/v1/boards/:boardId/items/:itemId */
  router.get('/boards/:boardId/items/:itemId', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'read:canvas');
    if ('error' in resolved) return resolved.error;
    const graph = await readPublicBoardGraph(db, c.env, resolved.board);
    const item = graph.objects.find((o) => o.id.toLowerCase() === c.req.param('itemId').toLowerCase());
    if (!item) return c.json({ error: 'Item not found' }, 404);
    return c.json({ boardId: resolved.board.id, revision: resolved.board.canvasRevision, item: publicItemView(item) });
  });

  /** POST /api/v1/boards/:boardId/items — create one object. */
  router.post('/boards/:boardId/items', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'write:canvas');
    if ('error' in resolved) return resolved.error;
    const { board, auth } = resolved;

    const body = await parseOptionalBody(c, ItemBodySchema);
    const kind = typeof body.kind === 'string' ? body.kind.slice(0, 48) : '';
    // NOT a second validator: the same predicate the in-product save path uses.
    if (!isCreationObjectKind(kind)) {
      return c.json({ error: `Unsupported item kind: ${kind || 'missing'}`, code: 'UNSUPPORTED_KIND' }, 400);
    }
    const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : crypto.randomUUID();

    const graph = await readPublicBoardGraph(db, c.env, board);
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
    const widgetError = await publicWidgetRefsValid(db, [item], board.tenantId);
    if (widgetError) return c.json({ error: widgetError, code: 'WIDGET_NOT_REGISTERED' }, 400);

    const revision = await commitPublicBoardGraph(
      db, c.env, (p) => c.executionCtx.waitUntil(p), board, auth, objects, graph.connections,
      { type: 'canvas.item.created', objectId: id, data: { item: publicItemView(item) } },
      c.req.header('Idempotency-Key')?.slice(0, 128) || null,
    );
    return c.json({ boardId: board.id, revision, item: publicItemView(item) }, 201);
  });

  /** PATCH /api/v1/boards/:boardId/items/:itemId — merge geometry and/or content. */
  router.patch('/boards/:boardId/items/:itemId', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'write:canvas');
    if ('error' in resolved) return resolved.error;
    const { board, auth } = resolved;

    const body = await parseOptionalBody(c, ItemBodySchema);
    const graph = await readPublicBoardGraph(db, c.env, board);
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

    const revision = await commitPublicBoardGraph(
      db, c.env, (p) => c.executionCtx.waitUntil(p), board, auth, objects, graph.connections,
      { type: 'canvas.item.updated', objectId: updated.id, data: { item: publicItemView(updated) } },
      c.req.header('Idempotency-Key')?.slice(0, 128) || null,
    );
    return c.json({ boardId: board.id, revision, item: publicItemView(updated) });
  });

  /** DELETE /api/v1/boards/:boardId/items/:itemId */
  router.delete('/boards/:boardId/items/:itemId', async (c) => {
    const resolved = await resolveBoard(c, c.req.param('boardId'), 'write:canvas');
    if ('error' in resolved) return resolved.error;
    const { board, auth } = resolved;

    const graph = await readPublicBoardGraph(db, c.env, board);
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

    const revision = await commitPublicBoardGraph(
      db, c.env, (p) => c.executionCtx.waitUntil(p), board, auth, objects, connections,
      { type: 'canvas.item.deleted', objectId: item.id, data: { itemId: item.id, kind: item.kind } },
      c.req.header('Idempotency-Key')?.slice(0, 128) || null,
    );
    return c.json({ boardId: board.id, revision, deleted: item.id });
  });

  return router;
}

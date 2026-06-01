/**
 * Generic segment-scoped tracker CRUD — the single factory behind every simple
 * tracker surface (governance compliance tools, product-management trackers, …).
 * One place for: (tenantId, segmentId) scoping, field whitelisting, date coercion,
 * and role gating. Add a tracker = a table + a field whitelist, not a new router.
 */

import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { emitWebhookEvent, type WebhookEvent } from '../../application/seams/webhookService';

/** The (tenantId, segmentId) scope every tracker query filters by. */
export function scope(c: Context<HonoEnv>): { tenantId: number; segmentId: string } {
  return { tenantId: c.get('tenantId'), segmentId: c.get('segmentId') as string };
}

export interface TrackerOpts {
  /** Drizzle field names accepted on create/update (whitelist). */
  fields: string[];
  /** Subset of `fields` required (non-empty) on create. */
  required?: string[];
  /**
   * Optional outbound-webhook trigger: when a create/update sets `field` to
   * `value`, emit `event` (segment-scoped) with the written row as the payload.
   * Emission is fire-and-forget (executionCtx.waitUntil) and never blocks or
   * fails the response — it is skipped when no execution context is present
   * (e.g. unit tests that don't supply one).
   */
  emit?: { field: string; value: string; event: WebhookEvent };
}

/** Fire-and-forget webhook emit when a write set the trigger field to its value. */
function maybeEmit(
  c: Context<HonoEnv>,
  db: Db,
  opts: TrackerOpts,
  written: Record<string, unknown>,
  row: Record<string, unknown> | undefined,
): void {
  const e = opts.emit;
  if (!e || !row || written[e.field] !== e.value) return;
  const waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
  if (!waitUntil) return;
  const { tenantId, segmentId } = scope(c);
  const eventId = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : crypto.randomUUID();
  waitUntil(
    emitWebhookEvent(db, { tenantId, segmentId, eventType: e.event, eventId, data: row }).catch(() => { /* best-effort */ }),
  );
}

/** Coerce JSON values to column types: ISO strings for *At/*Date fields → Date. */
function coerce(field: string, value: unknown): unknown {
  if (typeof value === 'string' && /(At|Date)$/.test(field) && !Number.isNaN(Date.parse(value))) {
    return new Date(value);
  }
  return value;
}

function pick(body: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = coerce(f, body[f]);
  return out;
}

/**
 * Segment-scoped CRUD for a tracker table. The table MUST have id/tenantId/
 * segmentId columns; typed loosely because the factory is generic over many
 * tables (the field whitelist + DB constraints + tests are the contract).
 * List is read for any member; mutations require manager+.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTrackerRoutes(db: Db, table: any, opts: TrackerOpts): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const rows = await db.select().from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)));
    return c.json(rows);
  });

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<Record<string, unknown>>();
    for (const r of opts.required ?? []) {
      const v = body[r];
      if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
        return c.json({ error: `${r} is required` }, 400);
      }
    }
    const written = pick(body, opts.fields);
    const rows = (await db.insert(table)
      .values({ ...written, tenantId, segmentId })
      .returning()) as Array<Record<string, unknown>>;
    maybeEmit(c, db, opts, written, rows[0]);
    return c.json(rows[0], 201);
  });

  router.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const patch = pick(await c.req.json<Record<string, unknown>>(), opts.fields);
    if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);
    patch.updatedAt = new Date();
    const rows = (await db.update(table).set(patch)
      .where(and(eq(table.id, id), eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)))
      .returning()) as Array<Record<string, unknown>>;
    if (!rows[0]) return c.json({ error: 'not found' }, 404);
    maybeEmit(c, db, opts, patch, rows[0]);
    return c.json(rows[0]);
  });

  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const rows = (await db.delete(table)
      .where(and(eq(table.id, id), eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)))
      .returning()) as Array<{ id: string }>;
    if (!rows[0]) return c.json({ error: 'not found' }, 404);
    return c.json({ deleted: rows[0].id });
  });

  return router;
}

/** Mount a list of trackers onto a parent router under their paths. */
export function mountTrackers(
  parent: Hono<HonoEnv>,
  db: Db,
  trackers: Array<{ path: string; table: unknown; opts: TrackerOpts }>,
): void {
  for (const t of trackers) parent.route(t.path, createTrackerRoutes(db, t.table, t.opts));
}

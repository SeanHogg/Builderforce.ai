import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
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
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { emitWebhookEvent, type WebhookEvent } from '../../application/seams/webhookService';
import { getOrSetCached, invalidateCached, bumpCacheVersion, trackerCacheKey, bumpTicketSearchVersion } from '../../infrastructure/cache/readThroughCache';
import { parseBody, zJsonObject } from './requestBody';
import type { MutationAction } from '../../application/governance/mutationAudit';
import { auditGovernanceMutation } from './governanceAudit';

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
  /**
   * Dual-scope this tracker by an optional nullable `projectId` column. When set,
   * GET honours `?project=<id>` (project view; absent = portfolio/segment view)
   * and create/update accept `projectId`. The table MUST have a `projectId` column.
   */
  projectScoped?: boolean;
  /**
   * Read-through cache namespace. When set, GET is served via getOrSetCached and
   * every write invalidates the affected keys (the `:all` portfolio key always,
   * plus the specific `:p:<id>` key when the written row is project-scoped).
   */
  cacheNs?: string;
  /**
   * Cross-cache version tokens to bump on every write — for downstream rollups
   * (e.g. the ROI dashboard) that aggregate this table but live under their own
   * key. Receives the tenantId so keys can be tenant-scoped.
   */
  bumpVersionKeys?: (tenantId: number) => string[];
  /**
   * Extra columns to set on CREATE that are never client-writable — an actor id
   * read off the authenticated request, never off the body. Not part of `fields`,
   * so no whitelist entry is needed and a client cannot override it by sending
   * the same key; applied on insert only, never on update.
   */
  serverFieldsOnCreate?: (c: Context<HonoEnv>) => Record<string, unknown>;
  /**
   * Record every create / update / delete in the ONE governance mutation-audit envelope
   * (`application/governance/mutationAudit.ts`) under this entity name. Opt-in: the factory also
   * backs product-management trackers that have their own activity story.
   */
  auditEntity?: string;
  /**
   * Refuse a mutation of a row the tracker's users must not change by hand (e.g. a scan the platform
   * recorded for an agent PR). Receives the existing row and, for an update, the whitelisted patch;
   * returns the refusal reason (answered 403) or null to allow. Evaluated before the write.
   */
  /**
   * Shape every row the tracker RETURNS (list, create, update): drop or rewrite a column that must not
   * reach a client. The stored row is untouched. Used where a column holds something server-internal
   * (a data subject request's private export key).
   */
  project?: (row: Record<string, unknown>) => Record<string, unknown>;
  guardMutation?: (op: 'create' | 'update' | 'delete', row: Record<string, unknown>, patch: Record<string, unknown> | null) => string | null;
}

/** Write the audit envelope for one tracker mutation when the tracker opted in. Never throws. */
async function auditTrackerMutation(
  c: Context<HonoEnv>,
  db: Db,
  opts: TrackerOpts,
  action: MutationAction,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  if (!opts.auditEntity) return;
  const row = after ?? before;
  const id = row && (typeof row.id === 'string' || typeof row.id === 'number') ? row.id : null;
  await auditGovernanceMutation(c, db, opts.auditEntity, id, action, before, after);
}

/** Parse a positive integer `?project=` query param, else undefined (portfolio). */
function parseProjectId(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Invalidate the portfolio key plus the row's project key (if any). */
async function invalidateTracker(
  env: Env,
  opts: TrackerOpts,
  tenantId: number,
  segmentId: string,
  projectId: unknown,
): Promise<void> {
  if (opts.cacheNs) {
    await invalidateCached(env, trackerCacheKey(opts.cacheNs, tenantId, segmentId));
    if (typeof projectId === 'number') {
      await invalidateCached(env, trackerCacheKey(opts.cacheNs, tenantId, segmentId, projectId));
    }
  }
  const vks = opts.bumpVersionKeys?.(tenantId) ?? [];
  for (const vk of vks) {
    await bumpCacheVersion(env, vk);
  }
  // Roadmap items and the PMO trackers (portfolio/initiative/objective/KR) are all
  // link-picker ticket kinds — orphan the chat↔ticket typeahead when one changes.
  // Gated so unrelated trackers (governance tools, …) don't over-invalidate it.
  if (opts.cacheNs === 'roadmap' || vks.some((k) => k.startsWith('pmo-version'))) {
    await bumpTicketSearchVersion(env, tenantId);
  }
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
    emitWebhookEvent(db, { tenantId, segmentId, eventType: e.event, eventId, data: row }, { env: c.env }).catch((error) => { /* best-effort */ 
      reportCaughtError(error, { source: "presentation/routes/segmentTrackerRoutes.ts", operation: "maybeEmit" });
    }),
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
  // projectId is part of the write whitelist for dual-scoped trackers.
  const writeFields = opts.projectScoped ? [...opts.fields, 'projectId'] : opts.fields;

  router.get('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = opts.projectScoped ? parseProjectId(c.req.query('project')) : undefined;
    const load = () => {
      const conds = [eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)];
      if (projectId !== undefined) conds.push(eq(table.projectId, projectId));
      return db.select().from(table).where(and(...conds));
    };
    const out = (rows: unknown) => (opts.project ? (rows as Array<Record<string, unknown>>).map(opts.project) : rows);
    if (!opts.cacheNs) return c.json(out(await load()));
    const key = trackerCacheKey(opts.cacheNs, tenantId, segmentId, projectId);
    return c.json(out(await getOrSetCached(c.env as Env, key, load)));
  });

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    // Any JSON object: the per-tracker `fields` whitelist (`pick`) is the column
    // contract, and `required` answers its own "X is required".
    const body = await parseBody(c, zJsonObject);
    for (const r of opts.required ?? []) {
      const v = body[r];
      if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
        return c.json({ error: `${r} is required` }, 400);
      }
    }
    const written = pick(body, writeFields);
    const createRefusal = opts.guardMutation?.('create', {}, written);
    if (createRefusal) return c.json({ error: createRefusal }, 403);
    const rows = (await db.insert(table)
      .values({ ...written, tenantId, segmentId, ...opts.serverFieldsOnCreate?.(c) })
      .returning()) as Array<Record<string, unknown>>;
    maybeEmit(c, db, opts, written, rows[0]);
    await invalidateTracker(c.env as Env, opts, tenantId, segmentId, rows[0]?.projectId);
    await auditTrackerMutation(c, db, opts, 'create', null, rows[0] ?? null);
    return c.json(rows[0] && opts.project ? opts.project(rows[0]) : rows[0], 201);
  });

  router.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const patch = pick(await parseBody(c, zJsonObject), writeFields);
    if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);
    patch.updatedAt = new Date();
    // The before-image only when the tracker is audited — one extra keyed read, not paid by the rest.
    const before = opts.auditEntity || opts.guardMutation
      ? ((await db.select().from(table)
        .where(and(eq(table.id, id), eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)))
        .limit(1)) as Array<Record<string, unknown>>)[0] ?? null
      : null;
    const refusal = before && opts.guardMutation?.('update', before, patch);
    if (refusal) return c.json({ error: refusal }, 403);
    const rows = (await db.update(table).set(patch)
      .where(and(eq(table.id, id), eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)))
      .returning()) as Array<Record<string, unknown>>;
    if (!rows[0]) return c.json({ error: 'not found' }, 404);
    maybeEmit(c, db, opts, patch, rows[0]);
    await invalidateTracker(c.env as Env, opts, tenantId, segmentId, rows[0]?.projectId);
    await auditTrackerMutation(c, db, opts, 'update', before, rows[0] ?? null);
    return c.json(opts.project ? opts.project(rows[0]) : rows[0]);
  });

  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    if (opts.guardMutation) {
      const [existing] = (await db.select().from(table)
        .where(and(eq(table.id, id), eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)))
        .limit(1)) as Array<Record<string, unknown>>;
      const refusal = existing && opts.guardMutation('delete', existing, null);
      if (refusal) return c.json({ error: refusal }, 403);
    }
    const rows = (await db.delete(table)
      .where(and(eq(table.id, id), eq(table.tenantId, tenantId), eq(table.segmentId, segmentId)))
      .returning()) as Array<{ id: string; projectId?: unknown }>;
    if (!rows[0]) return c.json({ error: 'not found' }, 404);
    await invalidateTracker(c.env as Env, opts, tenantId, segmentId, rows[0].projectId);
    await auditTrackerMutation(c, db, opts, 'delete', rows[0] as unknown as Record<string, unknown>, null);
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

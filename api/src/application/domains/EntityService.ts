/**
 * The generic domain-entity use cases (PRD 20 §5 step 5, §6.1).
 *
 * ONE service over 244 consolidated tables. That is not a shortcut — it is the
 * same argument §0 makes about the schema, applied to the layer above it: the
 * use cases genuinely ARE identical (list this seat's rows, open one, create
 * one, correct one, retire one), and the per-table difference is the DEFINITION
 * in `entityCatalog.ts`, which is data. 244 near-identical services would be the
 * duplication the document exists to delete, re-created one tier up — and 244
 * chances to forget tenant scoping, bounds, caching or redaction.
 *
 * LAYER CONTRACT (§6.1). Application layer: use cases, tenancy, cache keys and
 * invalidation. No HTTP — the route group parses and serialises; every function
 * here takes a tenant id it can trust and returns plain data.
 *
 * TENANCY IS STRUCTURAL, NOT REMEMBERED. Every read filters on the reflected
 * tenant column and every write stamps it from the session, so a table cannot be
 * added to the catalog and quietly skip the filter. A table with NO tenant
 * column is reference data — global, and therefore never writable through a
 * tenant's surface, because "which tenant's edit wins" has no answer.
 *
 * CACHING (§6.3, and the platform's read-heavy rule). Lists are read far more
 * than they are written and their keyspace is unbounded (limit × offset ×
 * search), so each entity's reads carry a VERSION TOKEN: a write bumps the token
 * and orphans every key derived from it at once, rather than enumerating keys
 * that cannot be enumerated. Point reads invalidate by key.
 *
 * WHAT THIS DELIBERATELY IS NOT. It is not a SQL console. Columns are the
 * reflected, redacted set; identifiers never come from a request; limits are
 * bounded; read-only entities reject writes; and the ordering column is chosen
 * by the definition, not by the caller — an ORDER BY a client can name is an
 * index-scan denial of service on a table with six-figure row counts.
 */
import { and, asc, count, desc, eq, getTableColumns, ilike, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import {
  bumpCacheVersion,
  getCacheVersion,
  getOrSetCached,
  invalidateCached,
} from '../../infrastructure/cache/readThroughCache';
import { recordActivity } from '../activity/activityLog';
import type { Env } from '../../env';
import { invalidateDomain } from '../kernel/DomainService';
import { isDomain, registerObject } from '../kernel/ObjectRegistry';
import { entitiesForScope, findEntity } from './entityCatalog';
import type { EntityDef, EntityScope } from './entityDefinition';

export type EntityRow = Record<string, unknown>;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const clampLimit = (n: number | undefined) =>
  !n || n < 1 ? DEFAULT_LIMIT : Math.min(Math.floor(n), MAX_LIMIT);
const clampOffset = (n: number | undefined) => (!n || n < 0 ? 0 : Math.floor(n));

/** The failure mode a route turns into a status code. Thrown rather than
 *  returned so a use case cannot half-succeed past a rejected input. */
export class EntityError extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'EntityError';
  }
}

const columnsOf = (def: EntityDef) => getTableColumns(def.table) as Record<string, PgColumn>;

/**
 * One column by its Drizzle property key.
 *
 * Every key this is called with came from reflection over the same table, so a
 * miss is a broken definition rather than bad input — but it is worth one line
 * to say so, because the alternative is a `!` that turns a catalog bug into an
 * unreadable driver error at runtime.
 */
function col(def: EntityDef, key: string): PgColumn {
  const column = columnsOf(def)[key];
  if (!column) throw new EntityError(400, `${def.name} has no column ${key}`);
  return column;
}

/** Physical-name-keyed projection of the PUBLIC columns. Every read and every
 *  `returning()` goes through this, which is what makes redaction structural:
 *  there is no code path that selects a column this does not name. */
function projection(def: EntityDef): Record<string, PgColumn> {
  const out: Record<string, PgColumn> = {};
  for (const c of def.columns) out[c.name] = col(def, c.key);
  return out;
}

const versionKey = (tenantId: number, def: EntityDef) => `kernel:entity:v:${tenantId}:${def.name}`;
const rowKey = (tenantId: number, def: EntityDef, id: string) =>
  `kernel:entity:${tenantId}:${def.name}:row:${id}`;

/** Tenant predicate, or nothing for global reference data. */
function tenantWhere(def: EntityDef, tenantId: number): SQL | undefined {
  if (!def.tenantKey) return undefined;
  return eq(col(def, def.tenantKey), tenantId);
}

function primaryKeyColumn(def: EntityDef): PgColumn {
  if (!def.primaryKey) {
    throw new EntityError(400, `${def.name} has no single-column primary key to address a row by`);
  }
  return col(def, def.primaryKey);
}

/**
 * Coerce one JSON value to what the column expects.
 *
 * A generic writer receives JSON, and JSON has no dates and no numerics. Doing
 * this once here — rather than per table, or not at all and letting the driver
 * throw — is what lets 244 tables share a create path.
 */
function coerce(column: PgColumn, value: unknown, field: string): unknown {
  if (value === null) {
    if (column.notNull) throw new EntityError(400, `${field} may not be null`);
    return null;
  }
  switch (column.dataType) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new EntityError(400, `${field} must be a number`);
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      throw new EntityError(400, `${field} must be a boolean`);
    case 'date': {
      const d = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new EntityError(400, `${field} must be a date`);
      return d;
    }
    case 'json':
    case 'array':
      return value;
    case 'bigint':
      return typeof value === 'bigint' ? value : String(value);
    default: {
      // `numeric` columns arrive as Drizzle strings; so does everything textual.
      if (typeof value === 'object') throw new EntityError(400, `${field} must be a scalar`);
      const s = String(value);
      /*
       * A NUMERIC column is a string to Drizzle — it refuses to round-trip a decimal
       * through a float — but it is still a number to Postgres. Without this check the
       * `number` branch above never sees it, `'abc'` travels all the way to the driver,
       * and the caller gets a 500 with a Postgres syntax error instead of the 400 this
       * layer exists to give them. Checked here rather than by widening the `number`
       * branch, because the VALUE must stay a string all the way to the wire.
       */
      if (column.columnType === 'PgNumeric' && !Number.isFinite(Number(s))) {
        throw new EntityError(400, `${field} must be a number`);
      }
      if (column.enumValues && column.enumValues.length > 0 && !column.enumValues.includes(s)) {
        throw new EntityError(400, `${field} must be one of: ${column.enumValues.join(', ')}`);
      }
      return s;
    }
  }
}

/**
 * Map a request body onto writable columns.
 *
 * Unknown fields are REJECTED rather than dropped. A generic API that silently
 * ignores what it was sent is one where a typo looks exactly like a successful
 * write, and the row that comes back looks right because it never had the field.
 */
function values(def: EntityDef, body: Record<string, unknown>, mode: 'create' | 'update'): EntityRow {
  if (!def.writable) throw new EntityError(403, `${def.name} is read-only`);
  const byName = new Map(def.columns.map((c) => [c.name, c]));
  const out: EntityRow = {};
  const unknown: string[] = [];
  const notWritable: string[] = [];

  for (const [field, value] of Object.entries(body)) {
    const spec = byName.get(field);
    if (!spec) {
      // A redacted column exists but is withheld — say which case this is, so a
      // caller is not left debugging a field the schema really does have.
      (def.redacted.includes(field) ? notWritable : unknown).push(field);
      continue;
    }
    if (!spec.writable) {
      notWritable.push(field);
      continue;
    }
    out[spec.key] = coerce(col(def, spec.key), value, field);
  }

  if (unknown.length) throw new EntityError(400, `unknown field(s): ${unknown.join(', ')}`);
  if (notWritable.length) throw new EntityError(403, `field(s) not writable: ${notWritable.join(', ')}`);

  if (mode === 'create') {
    const missing = def.columns.filter((c) => c.required && out[c.key] === undefined).map((c) => c.name);
    if (missing.length) throw new EntityError(400, `missing required field(s): ${missing.join(', ')}`);
    if (Object.keys(out).length === 0) throw new EntityError(400, 'empty body');
  } else if (Object.keys(out).length === 0) {
    throw new EntityError(400, 'no writable field supplied');
  }

  return out;
}

/** Resolve `(scope, name)` or fail the way the route reports a 404. */
export function requireEntity(scope: EntityScope, name: string): EntityDef {
  const def = findEntity(scope, name);
  if (!def) throw new EntityError(404, `unknown entity ${scope}/${name}`);
  return def;
}

/**
 * Refuse a generic read of a table whose rows are not a tenant's to see.
 *
 * A tenant-less table is either global reference data (declared, and therefore
 * fine) or a store scoped NARROWER than a tenant — a one-time code against an
 * email address, a visitor's session. There is no tenant predicate that makes
 * the second case safe, so the generic reader does not serve it at all: its real
 * code path is the service that owns the flow.
 */
function requireReadable(def: EntityDef): EntityDef {
  if (!def.readable) {
    throw new EntityError(
      403,
      `${def.name} is not readable through the generic surface — it is scoped narrower than a tenant`,
    );
  }
  return def;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type EntityDescriptor = {
  name: string;
  kind: string;
  scope: EntityScope;
  readable: boolean;
  writable: boolean;
  registers: boolean;
  titleField: string | null;
  fields: { name: string; type: string; required: boolean; writable: boolean; options: readonly string[] | null }[];
  /** Named, not hidden: a caller can see that a column exists and is withheld. */
  redactedFields: string[];
};

/** What this seat owns, as shapes. Pure metadata — no database, so a surface can
 *  render its tabs before a single row is read. */
export function describeScope(scope: EntityScope): EntityDescriptor[] {
  return entitiesForScope(scope).map((def) => ({
    name: def.name,
    kind: def.kind,
    scope: def.scope,
    readable: def.readable,
    writable: def.writable,
    registers: def.registers,
    titleField: def.columns.find((c) => c.key === def.titleKey)?.name ?? null,
    fields: def.columns.map((c) => ({
      name: c.name,
      type: c.dataType,
      required: c.required,
      writable: c.writable,
      options: c.enumValues,
    })),
    redactedFields: def.redacted,
  }));
}

/**
 * Row counts for every entity in a scope, in ONE query.
 *
 * The per-entity alternative is 46 round trips to render the Growth seat's tab
 * strip — the fan-out anti-pattern the platform rejects outright. Identifiers
 * come from the catalog (module-load literals), never from a request, so the
 * `sql.identifier` here cannot carry input.
 */
export async function countScope(
  db: Db,
  env: Env,
  tenantId: number,
  scope: EntityScope,
): Promise<Record<string, number>> {
  const defs = entitiesForScope(scope).filter((d) => d.readable);
  if (defs.length === 0) return {};

  return getOrSetCached(
    env,
    `kernel:entity:counts:${tenantId}:${scope}`,
    async () => {
      const parts = defs.map((def) => {
        const where = def.tenantKey ? sql` WHERE tenant_id = ${tenantId}` : sql``;
        return sql`SELECT ${def.name} AS entity, COUNT(*)::int AS n FROM ${sql.identifier(def.name)}${where}`;
      });
      const rows = await db.execute(sql.join(parts, sql` UNION ALL `));
      const list = ((rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])) as {
        entity: string;
        n: number | string;
      }[];
      const out: Record<string, number> = {};
      for (const def of defs) out[def.name] = 0;
      for (const r of list) out[r.entity] = Number(r.n);
      return out;
    },
    { kvTtlSeconds: 60, l1TtlMs: 15_000 },
  );
}

export type EntityPage = { rows: EntityRow[]; total: number; limit: number; offset: number };

/** One page of an entity's rows, newest first, tenant-scoped and bounded. */
export async function listRows(
  db: Db,
  env: Env,
  tenantId: number,
  def: EntityDef,
  opts: { limit?: number; offset?: number; q?: string; includeArchived?: boolean } = {},
): Promise<EntityPage> {
  requireReadable(def);
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const q = (opts.q ?? '').trim().slice(0, 120);

  const version = await getCacheVersion(env, versionKey(tenantId, def));
  const key =
    `kernel:entity:${tenantId}:${def.name}:v${version}:${limit}:${offset}` +
    `:${opts.includeArchived ? 'all' : 'live'}:${q}`;

  return getOrSetCached(
    env,
    key,
    async () => {
      const where: SQL[] = [];
      const scoped = tenantWhere(def, tenantId);
      if (scoped) where.push(scoped);
      if (def.archiveKey && !opts.includeArchived) where.push(isNull(col(def, def.archiveKey)));
      if (q && def.titleKey) where.push(ilike(col(def, def.titleKey), `%${q}%`));

      const predicate = where.length ? and(...where) : undefined;
      const order = def.orderKey ? desc(col(def, def.orderKey)) : asc(primaryKeyColumn(def));

      const [rows, totals] = await Promise.all([
        db.select(projection(def)).from(def.table).where(predicate).orderBy(order).limit(limit).offset(offset),
        db.select({ n: count() }).from(def.table).where(predicate),
      ]);

      return { rows: rows as EntityRow[], total: Number(totals[0]?.n ?? 0), limit, offset };
    },
    { kvTtlSeconds: 120, l1TtlMs: 20_000 },
  );
}

/** One row, tenant-scoped: another tenant's id resolves to null, never to their
 *  row — the same contract `getObject` states for the registry. */
export async function getRow(
  db: Db,
  env: Env,
  tenantId: number,
  def: EntityDef,
  id: string,
): Promise<EntityRow | null> {
  requireReadable(def);
  return getOrSetCached(env, rowKey(tenantId, def, id), async () => {
    const pk = primaryKeyColumn(def);
    const where: SQL[] = [eq(pk, coerce(pk, id, 'id'))];
    const scoped = tenantWhere(def, tenantId);
    if (scoped) where.push(scoped);
    const [row] = await db.select(projection(def)).from(def.table).where(and(...where)).limit(1);
    return (row as EntityRow | undefined) ?? null;
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Who is writing.
 *
 * `machine` is not cosmetic: authorship recorded as a person when an on-prem
 * agent host did the write is the exact defect `Vars.machineActor` exists to
 * prevent, and `activity_log.actor_type` is where it would be told.
 */
export type Actor = { userId?: string | null; name?: string | null; machine?: boolean };

/** Everything a write must do besides writing: refresh the caches it just
 *  invalidated the premise of, keep the registry current, and leave a trace.
 *  Collected in one place so no caller can do three of the four. */
async function afterWrite(
  db: Db,
  env: Env,
  tenantId: number,
  def: EntityDef,
  row: EntityRow,
  verb: 'created' | 'updated' | 'archived',
  actor: Actor,
): Promise<void> {
  const id = def.primaryKey ? String(row[col(def, def.primaryKey).name] ?? '') : '';
  const title = def.titleKey ? ((row[col(def, def.titleKey).name] as string | null) ?? null) : null;

  let objectId: string | null = null;
  if (def.registers && isDomain(def.scope) && id) {
    const registered = await registerObject(db, env, {
      tenantId,
      kind: def.kind,
      refId: id,
      domain: def.scope,
      title: title ?? null,
    });
    objectId = registered.id;
  }

  // Through the port, not a hand-built row: this used to insert straight into `db`,
  // which both re-derived the projection `toActivityRow` owns AND wrote to primary
  // while the audit timeline reads the transactional endpoint.
  await recordActivity(env, db, {
    tenantId,
    actor: {
      type: actor.machine ? 'host_agent' : actor.userId ? 'human' : 'system',
      ref: actor.userId ?? null,
      name: actor.name ?? 'System',
    },
    verb: `${def.kind}.${verb}`,
    targetType: def.name,
    targetId: id || null,
    targetLabel: title ?? null,
    objectId,
  });

  await Promise.all([
    bumpCacheVersion(env, versionKey(tenantId, def)),
    invalidateCached(env, rowKey(tenantId, def, id)),
    invalidateCached(env, `kernel:entity:counts:${tenantId}:${def.scope}`),
    isDomain(def.scope) ? invalidateDomain(env, tenantId, def.scope) : Promise.resolve(),
  ]);
}

export async function createRow(
  db: Db,
  env: Env,
  tenantId: number,
  def: EntityDef,
  body: Record<string, unknown>,
  actor: Actor = {},
): Promise<EntityRow> {
  const record = values(def, body, 'create');
  if (def.tenantKey) record[def.tenantKey] = tenantId;

  const [row] = await db
    .insert(def.table)
    .values(record as never)
    .returning(projection(def));
  if (!row) throw new EntityError(400, `${def.name}: insert returned no row`);

  await afterWrite(db, env, tenantId, def, row as EntityRow, 'created', actor);
  return row as EntityRow;
}

export async function updateRow(
  db: Db,
  env: Env,
  tenantId: number,
  def: EntityDef,
  id: string,
  body: Record<string, unknown>,
  actor: Actor = {},
): Promise<EntityRow> {
  const record = values(def, body, 'update');
  const pk = primaryKeyColumn(def);
  const where: SQL[] = [eq(pk, coerce(pk, id, 'id'))];
  const scoped = tenantWhere(def, tenantId);
  if (scoped) where.push(scoped);

  const [row] = await db
    .update(def.table)
    .set(record as never)
    .where(and(...where))
    .returning(projection(def));
  // No row means the id belongs to another tenant or to nothing at all, and both
  // answer the same way: it does not exist here.
  if (!row) throw new EntityError(404, `${def.name}/${id} not found`);

  await afterWrite(db, env, tenantId, def, row as EntityRow, 'updated', actor);
  return row as EntityRow;
}

/**
 * Retire a row.
 *
 * Soft when the table declares a retirement column, hard only when it does not —
 * the same reasoning §2 gives `share_link` revocation: a row that vanishes takes
 * its history with it, and most of these tables are the history of something.
 */
export async function archiveRow(
  db: Db,
  env: Env,
  tenantId: number,
  def: EntityDef,
  id: string,
  actor: Actor = {},
): Promise<{ archived: boolean; deleted: boolean }> {
  if (!def.writable) throw new EntityError(403, `${def.name} is read-only`);
  const pk = primaryKeyColumn(def);
  const where: SQL[] = [eq(pk, coerce(pk, id, 'id'))];
  const scoped = tenantWhere(def, tenantId);
  if (scoped) where.push(scoped);

  if (def.archiveKey) {
    const [row] = await db
      .update(def.table)
      .set({ [def.archiveKey]: new Date() } as never)
      .where(and(...where))
      .returning(projection(def));
    if (!row) throw new EntityError(404, `${def.name}/${id} not found`);
    await afterWrite(db, env, tenantId, def, row as EntityRow, 'archived', actor);
    return { archived: true, deleted: false };
  }

  const [row] = await db.delete(def.table).where(and(...where)).returning(projection(def));
  if (!row) throw new EntityError(404, `${def.name}/${id} not found`);
  await afterWrite(db, env, tenantId, def, row as EntityRow, 'archived', actor);
  return { archived: false, deleted: true };
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/** Bind the connection once; the route group depends on THIS, not on a database
 *  — the same port shape `createObjectRegistry` and `createDomainService` use,
 *  and the reason a new route file does not join the layering baseline. */
export function createEntityService(db: Db, env: Env) {
  return {
    describe: (scope: EntityScope) => describeScope(scope),
    counts: (tenantId: number, scope: EntityScope) => countScope(db, env, tenantId, scope),
    list: (
      tenantId: number,
      scope: EntityScope,
      name: string,
      opts?: { limit?: number; offset?: number; q?: string; includeArchived?: boolean },
    ) => listRows(db, env, tenantId, requireEntity(scope, name), opts),
    get: (tenantId: number, scope: EntityScope, name: string, id: string) =>
      getRow(db, env, tenantId, requireEntity(scope, name), id),
    create: (
      tenantId: number,
      scope: EntityScope,
      name: string,
      body: Record<string, unknown>,
      actor?: Actor,
    ) => createRow(db, env, tenantId, requireEntity(scope, name), body, actor),
    update: (
      tenantId: number,
      scope: EntityScope,
      name: string,
      id: string,
      body: Record<string, unknown>,
      actor?: Actor,
    ) => updateRow(db, env, tenantId, requireEntity(scope, name), id, body, actor),
    archive: (tenantId: number, scope: EntityScope, name: string, id: string, actor?: Actor) =>
      archiveRow(db, env, tenantId, requireEntity(scope, name), id, actor),
  };
}

export type EntityService = ReturnType<typeof createEntityService>;

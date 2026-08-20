/**
 * The writer that makes the registry real (PRD 20 §2, §7).
 *
 * `objects` is the one NEW table in a document about deleting them, and it is
 * inert until something registers into it. Without a writer, `/api/objects/*`,
 * `/api/roster` and every domain surface answer honestly and emptily — which is
 * a schema that exists and a feature that does not.
 *
 * TWO HALVES, BOTH HERE:
 *
 *   1. **Projection.** `projectRegistry()` walks the platform's principal
 *      entities and registers each into `objects`, idempotently. Runs as a cron
 *      sweep, so a tenant's registry converges without every domain service
 *      having to remember a call, and re-running is free.
 *
 *   2. **Measurement.** The same walk already has the counts a seat's surface
 *      charts, so it writes them as `metric_facts` in the same pass — one row per
 *      (domain, day) for `<domain>.items` and `<domain>.events`. `MetricChart`
 *      then has something to draw for every seat on day one, instead of fifteen
 *      empty panels waiting on fifteen bespoke rollups.
 *
 * WHY A SWEEP AND NOT A WRITE HOOK. Both, eventually — a domain service that
 * calls `registerObject()` on write keeps the registry fresh to the second, and
 * PRD 20 §5 step 5 is where those calls land per family. The sweep is what makes
 * the registry correct for rows that ALREADY EXIST, which no write hook can do,
 * and what keeps it correct when a hook is forgotten. It is deliberately the
 * cheap half: `INSERT … ON CONFLICT DO UPDATE`, bounded per tenant per pass.
 *
 * SQL, not the ORM, and stated plainly: this is one INSERT…SELECT per kind. The
 * per-row alternative is N round trips against tables with six-figure row counts,
 * which is the fan-out anti-pattern the platform rejects outright.
 */
import { sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { registeredEntities } from '../domains/entityCatalog';
import { DOMAINS, isDomain, type Domain } from './ObjectRegistry';

/**
 * The projection map: which existing table becomes which registry kind.
 *
 * Deliberately a small, load-bearing set rather than all 387 — these are the
 * entities a person navigates to, which is what the registry is FOR (§7: one
 * detail route, one breadcrumb, recents derived rather than stored). A table
 * nobody opens does not need an addressable id.
 *
 * `idColumn` and `titleColumn` are raw column names, never interpolated user
 * input: they come from the literal below or from the entity catalog, both of
 * which are module-load constants.
 */
type Projection = {
  table: string;
  kind: string;
  domain: Domain;
  idColumn: string;
  titleColumn: string;
};

const PLATFORM_PROJECTIONS: readonly Projection[] = [
  { table: 'projects', kind: 'project', domain: 'delivery', idColumn: 'id', titleColumn: 'name' },
  /**
   * A PUBLISHED SITE, and the reason it is here rather than left to the entity
   * catalog: it is the ARTIFACT a founder's own customers arrive on, and
   * `growthRollup` attributes every lead and conversion to this object so
   * "what did the thing I built actually do for anyone" is a query rather than
   * two numbers that never meet.
   *
   * Its own kind and not `landing_page`: `(tenant_id, kind, ref_id)` is the
   * registry's uniqueness, both tables key on a serial int, and sharing a kind
   * would make `landing_pages` row 7 and `project_sites` row 7 the same object.
   */
  { table: 'project_sites', kind: 'site', domain: 'growth', idColumn: 'id', titleColumn: 'subdomain' },
  { table: 'tasks', kind: 'work_item', domain: 'delivery', idColumn: 'id', titleColumn: 'title' },
  { table: 'work_items', kind: 'work_item', domain: 'delivery', idColumn: 'id', titleColumn: 'title' },
  { table: 'creation_sessions', kind: 'creation_session', domain: 'canvas', idColumn: 'id', titleColumn: 'title' },
  { table: 'artifacts', kind: 'artifact', domain: 'canvas', idColumn: 'id', titleColumn: 'title' },
  { table: 'threads', kind: 'thread', domain: 'canvas', idColumn: 'id', titleColumn: 'title' },
  { table: 'ide_agents', kind: 'agent', domain: 'agents', idColumn: 'id', titleColumn: 'name' },
  { table: 'runs', kind: 'run', domain: 'agents', idColumn: 'id', titleColumn: 'label' },
  { table: 'catalog_items', kind: 'listing', domain: 'commerce', idColumn: 'id', titleColumn: 'title' },
  { table: 'party_roles', kind: 'party', domain: 'identity', idColumn: 'id', titleColumn: 'display_name' },
  { table: 'connections', kind: 'connection', domain: 'integrations', idColumn: 'id', titleColumn: 'display_name' },
  { table: 'users', kind: 'user', domain: 'identity', idColumn: 'id', titleColumn: 'display_name' },
];

/**
 * The consolidated half, derived from the catalog rather than restated.
 *
 * An entity that declares `registers: true` is one a person navigates to, and
 * the catalog already knows its table, its kind, its seat, its key and its
 * title column. Copying that here would be the two-sources-of-truth problem the
 * catalog exists to end — and the version that rots, because the copy is the one
 * nobody updates when a title column is renamed.
 */
function catalogProjections(): Projection[] {
  const out: Projection[] = [];
  for (const def of registeredEntities()) {
    // Kernel primitives belong to no seat, so they cannot derive a domain; they
    // are in PLATFORM_PROJECTIONS above, where the mapping is stated once.
    if (!isDomain(def.scope) || !def.primaryKey) continue;
    const physical = (key: string | null) => def.columns.find((c) => c.key === key)?.name ?? null;
    const idColumn = physical(def.primaryKey);
    if (!idColumn) continue;
    out.push({
      table: def.name,
      kind: def.kind,
      domain: def.scope,
      idColumn,
      titleColumn: physical(def.titleKey) ?? idColumn,
    });
  }
  return out;
}

/** Both halves, deduped on `(table, kind)` so a table that appears in the legacy
 *  list AND the catalog is projected once. */
const PROJECTIONS: readonly Projection[] = [
  ...PLATFORM_PROJECTIONS,
  ...catalogProjections().filter(
    (p) => !PLATFORM_PROJECTIONS.some((l) => l.table === p.table && l.kind === p.kind),
  ),
];

/** The roster as a SQL literal list. Built from the `DOMAINS` constant, never
 *  from input, so `sql.raw` here is a compile-time value — and an explicit IN
 *  list avoids relying on a driver coercing a JS array into `text[]` for
 *  `= ANY(...)`, which is the kind of thing that works until the driver changes. */
const DOMAIN_LIST = DOMAINS.map((d) => `'${d}'`).join(', ');

export interface ProjectionResult {
  registered: number;
  facts: number;
  skipped: string[];
}

/** Does a table exist on this database? A projection naming a table the codemod
 *  has not created yet is skipped, not fatal — the map is written against the
 *  target schema and lands ahead of some of it. */
async function tableExists(db: Db, table: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${table} LIMIT 1
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return list.length > 0;
}

/** Does a column exist? Guards the title/tenant column, which differs by table. */
async function columnExists(db: Db, table: string, column: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column} LIMIT 1
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return list.length > 0;
}

/**
 * Register every projected entity and write the day's counts.
 *
 * Idempotent end to end: registration is `ON CONFLICT DO UPDATE` on
 * `(tenant_id, kind, ref_id)`, and each metric row is `ON CONFLICT DO UPDATE` on
 * its `(tenant, metric, bucket, bucket_at, dimension_key)` point — so running the
 * sweep twice in a day corrects the number rather than doubling it.
 */
export async function projectRegistry(env: Env, db: Db = buildDatabase(env)): Promise<ProjectionResult> {
  let registered = 0;
  let facts = 0;
  const skipped: string[] = [];

  for (const p of PROJECTIONS) {
    if (!(await tableExists(db, p.table))) {
      skipped.push(`${p.table} (absent)`);
      continue;
    }
    if (!(await columnExists(db, p.table, 'tenant_id'))) {
      // A table with no tenant column cannot be registered per tenant, and
      // guessing a tenant is worse than skipping: `check-tenant-column.mjs`
      // names 71 such tables and every one is a decision, not an oversight.
      skipped.push(`${p.table} (no tenant_id)`);
      continue;
    }
    const titleColumn = (await columnExists(db, p.table, p.titleColumn)) ? p.titleColumn : p.idColumn;

    // Identifiers come from the PROJECTIONS literal above — never from a request —
    // so `sql.raw` here is a constant, not interpolated input.
    const result = await db.execute(sql`
      INSERT INTO objects (tenant_id, kind, ref_id, domain, title, updated_at)
      SELECT src.tenant_id,
             ${p.kind},
             src.${sql.raw(p.idColumn)}::text,
             ${p.domain},
             LEFT(COALESCE(src.${sql.raw(titleColumn)}::text, ''), 300),
             NOW()
      FROM ${sql.raw(p.table)} AS src
      WHERE src.tenant_id IS NOT NULL
      ON CONFLICT (tenant_id, kind, ref_id) DO UPDATE
        SET title = EXCLUDED.title, updated_at = NOW()
    `);
    registered += Number((result as unknown as { rowCount?: number }).rowCount ?? 0);
  }

  // ── measurement ─────────────────────────────────────────────────────────
  //
  // The two metrics every seat can chart on day one, computed from the registry
  // the pass just refreshed. The domain-specific keys in DOMAIN_MANIFEST fill in
  // as their features land; these two mean no surface renders fifteen empty
  // panels while that happens.
  const itemFacts = await db.execute(sql`
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
    SELECT o.tenant_id,
           o.domain || '.items',
           'day',
           DATE_TRUNC('day', NOW()),
           '',
           COUNT(*),
           'count',
           NOW()
    FROM objects o
    WHERE o.tenant_id IS NOT NULL AND o.archived_at IS NULL AND o.domain IN (${sql.raw(DOMAIN_LIST)})
    GROUP BY o.tenant_id, o.domain
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value = EXCLUDED.value, computed_at = NOW()
  `);
  facts += Number((itemFacts as unknown as { rowCount?: number }).rowCount ?? 0);

  const eventFacts = await db.execute(sql`
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
    SELECT a.tenant_id,
           o.domain || '.events',
           'day',
           DATE_TRUNC('day', a.occurred_at),
           '',
           COUNT(*),
           'count',
           NOW()
    FROM activity_log a
    JOIN objects o ON o.id = a.object_id
    WHERE a.tenant_id IS NOT NULL AND a.occurred_at >= NOW() - INTERVAL '30 days'
    GROUP BY a.tenant_id, o.domain, DATE_TRUNC('day', a.occurred_at)
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value = EXCLUDED.value, computed_at = NOW()
  `);
  facts += Number((eventFacts as unknown as { rowCount?: number }).rowCount ?? 0);

  return { registered, facts, skipped };
}

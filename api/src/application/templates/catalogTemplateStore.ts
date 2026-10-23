/**
 * The ONE templates use case over `catalog_items`.
 *
 * Every template the platform stores — a workspace's guided-setup manifest
 * (kind 'template'), a kanban board definition (kind 'kanban_template') and a
 * canvas graph (kind 'canvas_template') — is a `catalog_items` row, and every read
 * and write of one goes through here (migration 1263 folded `kanban_templates` and
 * `creation_session_templates` in). The kind-specific services above this
 * (`templateRegistry` / `templateService`, `kanban/kanbanTemplateService`,
 * `creation/canvasTemplates`) own their payload's SHAPE; this module owns the row:
 * tenant scoping, the declared cross-tenant marketplace reads, caching and the
 * install counter.
 *
 * CACHING lives in `templateCache.ts` (version tokens bumped on every write) and
 * the kind vocabulary + cacheable row shape in `templateKinds.ts`.
 */

import { desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { bumpTemplateVersions, publicTemplatesVersionKey, tenantTemplatesVersionKey, versionedRead } from './templateCache';
import {
  toStoredTemplate,
  type StoredTemplate,
  type TemplateKind,
  type TemplateVisibilityValue,
} from './templateKinds';
import { isUuid } from '../../domain/replay/replayScope';

type CatalogRow = typeof catalogItems.$inferSelect;

// ── Reads ───────────────────────────────────────────────────────────────────────

/** A workspace's own templates of `kind`, newest first — drafts and private rows
 *  included (audience filtering, e.g. "private = author only", is the caller's). */
export async function listTenantTemplates(
  db: Db,
  env: Env | undefined,
  args: { tenantId: number; kind: TemplateKind; segmentId?: string | null },
): Promise<StoredTemplate[]> {
  const { tenantId, kind, segmentId } = args;
  return versionedRead(env, tenantTemplatesVersionKey(tenantId, kind), `templates:list:${tenantId}:${kind}:${segmentId ?? '*'}`, async () => {
    const rows = await db
      .select()
      .from(catalogItems)
      .where(scopedToTenant(
        catalogItems,
        tenantId,
        eq(catalogItems.kind, kind),
        segmentId ? eq(catalogItems.segmentId, segmentId) : undefined,
      ))
      .orderBy(desc(catalogItems.updatedAt));
    return rows.map(toStoredTemplate);
  });
}

/**
 * Published (`visibility = 'public'`, `published_at` set) templates of `kind`,
 * most installed first; every one unless `limit` is given.
 *
 * `scope: 'platform'` is the platform-owned catalogue only (`tenant_id IS NULL`) —
 * what a signed-out visitor sees and what the manifest registry merges.
 * `scope: 'all'` widens to every workspace's public listing: the marketplace read
 * `catalog_items` exists to make legitimate, declared as such.
 */
export async function listPublicTemplates(
  db: Db,
  env: Env | undefined,
  args: { kind: TemplateKind; scope: 'platform' | 'all'; limit?: number },
): Promise<StoredTemplate[]> {
  const { kind, scope, limit } = args;
  return versionedRead(env, publicTemplatesVersionKey(kind), `templates:public:${kind}:${scope}:${limit ?? 'all'}`, async () => {
    const query = db
      .select()
      .from(catalogItems)
      .where(acrossTenants(
        catalogItems,
        'public_catalogue',
        eq(catalogItems.kind, kind),
        eq(catalogItems.visibility, 'public'),
        isNotNull(catalogItems.publishedAt),
        scope === 'platform' ? isNull(catalogItems.tenantId) : undefined,
      ))
      .orderBy(desc(catalogItems.installCount));
    // Unbounded unless the caller asks for a page — the pre-1263 kanban
    // marketplace list was unbounded, and the manifest registry asks for 200.
    const rows = limit === undefined ? await query : await query.limit(limit);
    return rows.map(toStoredTemplate);
  });
}

/** One of the workspace's own templates by id. A non-uuid id is a miss, never a
 *  cast error from Postgres. */
export async function getTenantTemplate(
  db: Db,
  env: Env | undefined,
  args: { tenantId: number; kind: TemplateKind; id: string },
): Promise<StoredTemplate | null> {
  const { tenantId, kind, id } = args;
  if (!isUuid(id)) return null;
  // Wrapped: the cache treats a bare null as a miss, so a "not found" would cost a
  // statement on every read.
  const { template } = await versionedRead(env, tenantTemplatesVersionKey(tenantId, kind), `templates:one:${tenantId}:${kind}:${id}`, async () => {
    const [row] = await db
      .select()
      .from(catalogItems)
      .where(scopedToTenant(catalogItems, tenantId, eq(catalogItems.kind, kind), eq(catalogItems.id, id)))
      .limit(1);
    return { template: row ? toStoredTemplate(row) : null };
  });
  return template;
}

/** A published template of `kind` by id, whichever workspace listed it — the
 *  marketplace preview / install read. */
export async function getPublicTemplate(
  db: Db,
  env: Env | undefined,
  args: { kind: TemplateKind; id: string },
): Promise<StoredTemplate | null> {
  const { kind, id } = args;
  if (!isUuid(id)) return null;
  const { template } = await versionedRead(env, publicTemplatesVersionKey(kind), `templates:public-one:${kind}:${id}`, async () => {
    const [row] = await db
      .select()
      .from(catalogItems)
      .where(acrossTenants(
        catalogItems,
        'public_catalogue',
        eq(catalogItems.kind, kind),
        eq(catalogItems.id, id),
        eq(catalogItems.visibility, 'public'),
        isNotNull(catalogItems.publishedAt),
      ))
      .limit(1);
    return { template: row ? toStoredTemplate(row) : null };
  });
  return template;
}

/** How many templates of `kind` the workspace (optionally one segment) holds —
 *  the plan-quota read. Uncached: a quota is checked right before a write. */
export async function countTenantTemplates(
  db: Db,
  args: { tenantId: number; kind: TemplateKind; segmentId?: string | null },
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(scopedToTenant(
      catalogItems,
      args.tenantId,
      eq(catalogItems.kind, args.kind),
      args.segmentId ? eq(catalogItems.segmentId, args.segmentId) : undefined,
    ));
  return Number(row?.count ?? 0);
}

// ── Writes ──────────────────────────────────────────────────────────────────────

/** The writable columns of a template row. */
export interface TemplateValues {
  slug?: string;
  name?: string;
  summary?: string | null;
  body?: unknown;
  category?: string | null;
  tags?: unknown;
  version?: string;
  visibility?: TemplateVisibilityValue;
  priceCents?: number | null;
  currency?: string | null;
  publisherRef?: string | null;
  segmentId?: string | null;
  createdBy?: string | null;
  publishedAt?: Date | null;
}

/** Which row a write targets inside the tenant: its id, or its `(kind, slug)` key. */
export type TemplateMatch = { id: string } | { slug: string };

function matchPredicate(match: TemplateMatch): SQL | undefined {
  if ('id' in match) return isUuid(match.id) ? eq(catalogItems.id, match.id) : undefined;
  return eq(catalogItems.slug, match.slug);
}

export async function insertTemplate(
  db: Db,
  env: Env | undefined,
  args: { tenantId: number; kind: TemplateKind; id?: string; values: TemplateValues & { slug: string; name: string } },
): Promise<string> {
  const id = args.id ?? crypto.randomUUID();
  const now = new Date();
  await db.insert(catalogItems).values({
    ...args.values,
    body: args.values.body as CatalogRow['body'],
    tags: args.values.tags as CatalogRow['tags'],
    id,
    tenantId: args.tenantId,
    kind: args.kind,
    // `isTemplate` is the template/instance flag the kernel filters on; a template
    // row that did not set it would be invisible to every generic surface.
    isTemplate: true,
    createdAt: now,
    updatedAt: now,
  });
  await bumpTemplateVersions(env, args.tenantId, args.kind);
  return id;
}

/** Update one of the workspace's templates. Returns the row's id, or null when no
 *  row matched. */
export async function updateTemplate(
  db: Db,
  env: Env | undefined,
  args: { tenantId: number; kind: TemplateKind; match: TemplateMatch; values: TemplateValues },
): Promise<string | null> {
  const target = matchPredicate(args.match);
  if (!target) return null;
  const { body, tags, ...rest } = args.values;
  const result = await db
    .update(catalogItems)
    .set({
      ...rest,
      ...(body !== undefined ? { body: body as CatalogRow['body'] } : {}),
      ...(tags !== undefined ? { tags: tags as CatalogRow['tags'] } : {}),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(catalogItems, args.tenantId, eq(catalogItems.kind, args.kind), target))
    .returning({ id: catalogItems.id });
  if (result.length === 0) return null;
  await bumpTemplateVersions(env, args.tenantId, args.kind);
  return result[0]!.id;
}

/** Delete one of the workspace's templates. Returns false when no row matched. */
export async function deleteTemplateRow(
  db: Db,
  env: Env | undefined,
  args: { tenantId: number; kind: TemplateKind; match: TemplateMatch },
): Promise<boolean> {
  const target = matchPredicate(args.match);
  if (!target) return false;
  const result = await db
    .delete(catalogItems)
    .where(scopedToTenant(catalogItems, args.tenantId, eq(catalogItems.kind, args.kind), target))
    .returning({ id: catalogItems.id });
  if (result.length === 0) return false;
  await bumpTemplateVersions(env, args.tenantId, args.kind);
  return true;
}

/**
 * Count an install against the template's row.
 *
 * DELIBERATELY CROSS-TENANT. The whole point of a marketplace template is that
 * another workspace installs it, and the row being counted belongs to the
 * PUBLISHER — scoping this write to the installing tenant would silently count
 * nothing for exactly the templates whose counts matter. The access predicate is
 * the id the caller already resolved plus the row's kind, and the only column it
 * touches is a counter.
 *
 * Best-effort by design: a counter that failed to increment must never fail an
 * install that worked.
 */
export async function recordTemplateInstall(
  db: Db,
  env: Env | undefined,
  args: { kind: TemplateKind; id: string },
): Promise<void> {
  if (!isUuid(args.id)) return; // built-ins live in code and have no row to count
  try {
    const [row] = await db
      .update(catalogItems)
      .set({ installCount: sql`${catalogItems.installCount} + 1` })
      .where(acrossTenants(catalogItems, 'public_catalogue', eq(catalogItems.id, args.id), eq(catalogItems.kind, args.kind)))
      .returning({ tenantId: catalogItems.tenantId });
    if (row) await bumpTemplateVersions(env, row.tenantId, args.kind);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/templates/catalogTemplateStore.ts',
      operation: `recordTemplateInstall:${args.kind}`,
      context: { id: args.id },
    });
  }
}

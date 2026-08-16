/**
 * Template registry — the ONE place that answers "what templates can this
 * workspace start from, and what is the manifest for key X?".
 *
 * Merges the same three sources the connector registry does, in the same order
 * and for the same reason:
 *   • built-in manifests (code, `defaults/`) — identical for every workspace;
 *   • the workspace's own saved templates (`catalog_items`, tenant-scoped);
 *   • MARKETPLACE templates a publisher listed publicly.
 *
 * A template IS a `catalog_items` row — the kernel table that already carries
 * every listing, preset and pack, with `kind = 'template'` and the manifest in
 * `body`. That is deliberate and it is what makes the marketplace surface free:
 * pricing, visibility, install counts, publisher attribution and the storefront
 * grid all already work on that table, so publishing a template is a row rather
 * than a subsystem.
 *
 * Neither a workspace's key nor a published one can shadow a built-in
 * (`isReservedTemplateKey`), so the merge has no precedence question to get
 * wrong. A workspace's own template beats a published one under the same key,
 * because the manifest its owner can see and edit is the one that should win.
 *
 * Reads are served through the shared read-through cache: the catalogue is hit
 * on every gallery render and every wizard open, and without it that is a table
 * scan per page view.
 */

import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  parseTemplateManifest,
  withDerivedConnectSteps,
  type TemplateManifest,
} from '../../domain/template/templateManifest';
import { BUILTIN_TEMPLATES, BUILTIN_TEMPLATE_LIST } from './defaults';

/** Where a manifest came from — drives "Built-in" / "Yours" / "Marketplace". */
export type TemplateOrigin = 'builtin' | 'tenant' | 'marketplace';

/** The `catalog_items.kind` a template row carries. */
export const TEMPLATE_CATALOG_KIND = 'template';

export interface ResolvedTemplate {
  manifest: TemplateManifest;
  origin: TemplateOrigin;
  /** `catalog_items.id` for stored templates; null for built-ins. */
  id: string | null;
  /** Publisher attribution, for a marketplace template. */
  publisherRef: string | null;
  installCount: number;
  version: string;
  priceCents: number | null;
  currency: string | null;
  updatedAt: string | null;
}

const catalogCacheKey = (tenantId: number): string => `templates:catalog:${tenantId}`;

/** Drop the cached catalogue for a workspace. Call after ANY template write. */
export async function invalidateTemplateCatalog(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, catalogCacheKey(tenantId));
}

function builtinResolved(manifest: TemplateManifest): ResolvedTemplate {
  return {
    manifest,
    origin: 'builtin',
    id: null,
    publisherRef: null,
    installCount: 0,
    version: '1.0.0',
    priceCents: null,
    currency: null,
    updatedAt: null,
  };
}

type CatalogRow = typeof catalogItems.$inferSelect;

/**
 * Turn a stored row into a resolved template, validating on READ.
 *
 * A stored manifest was validated on write, but a row can outlive a contract
 * change — a step kind that was later renamed, an output kind that was later
 * removed. Re-parsing here means a stale row is SKIPPED rather than handed to
 * the wizard half-understood: the template disappears from the gallery, which is
 * visible and reportable, instead of rendering a step nothing knows how to
 * validate and installing whatever the person typed.
 */
function rowToResolved(row: CatalogRow, origin: TemplateOrigin): ResolvedTemplate | null {
  try {
    return {
      manifest: withDerivedConnectSteps(parseTemplateManifest(row.body)),
      origin,
      id: row.id,
      publisherRef: row.publisherRef,
      installCount: row.installCount,
      version: row.version,
      priceCents: row.priceCents,
      currency: row.currency,
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/templates/templateRegistry.ts',
      operation: `rowToResolved:${row.slug}`,
    });
    return null;
  }
}

/** The workspace's own saved templates, drafts included. */
async function loadTenantTemplates(db: Db, tenantId: number): Promise<ResolvedTemplate[]> {
  const rows = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.tenantId, tenantId), eq(catalogItems.kind, TEMPLATE_CATALOG_KIND)))
    .orderBy(desc(catalogItems.updatedAt));
  return rows.map((r) => rowToResolved(r, 'tenant')).filter((t): t is ResolvedTemplate => t !== null);
}

/**
 * Published marketplace templates.
 *
 * `tenantId IS NULL OR tenantId <> this workspace` is the cross-tenant read this
 * table exists to make legitimate: `catalog_items.tenant_id` is nullable
 * precisely because the public catalogue is platform-owned, and a listing marked
 * public is a listing its owner asked the world to see. The workspace's own rows
 * are excluded here so a template it published does not appear twice — it is
 * already in the tenant list, where it can be edited.
 */
async function loadPublishedTemplates(db: Db, tenantId: number): Promise<ResolvedTemplate[]> {
  const rows = await db
    .select()
    .from(catalogItems)
    .where(and(
      eq(catalogItems.kind, TEMPLATE_CATALOG_KIND),
      eq(catalogItems.visibility, 'public'),
      or(isNull(catalogItems.tenantId), eq(catalogItems.tenantId, tenantId)),
    ))
    .orderBy(desc(catalogItems.installCount))
    .limit(200);
  return rows
    .filter((r) => r.tenantId !== tenantId && r.publishedAt !== null)
    .map((r) => rowToResolved(r, 'marketplace'))
    .filter((t): t is ResolvedTemplate => t !== null);
}

/**
 * The full catalogue for a workspace.
 *
 * A key collision resolves to the FIRST entry, and the order below is the
 * precedence stated in this module's header: built-in, then the workspace's own,
 * then published.
 */
export async function listTemplatesForTenant(
  db: Db,
  tenantId: number,
  env?: Env,
): Promise<ResolvedTemplate[]> {
  const load = async (): Promise<ResolvedTemplate[]> => {
    // Independent reads, so they overlap rather than queue.
    const [owned, published] = await Promise.all([
      loadTenantTemplates(db, tenantId),
      loadPublishedTemplates(db, tenantId),
    ]);
    const claimed = new Set([...BUILTIN_TEMPLATES.keys(), ...owned.map((t) => t.manifest.key)]);
    return [
      ...BUILTIN_TEMPLATE_LIST.map(builtinResolved),
      ...owned,
      ...published.filter((t) => !claimed.has(t.manifest.key)),
    ];
  };
  if (!env) return load();
  return getOrSetCached(env, catalogCacheKey(tenantId), load, { kvTtlSeconds: 300, l1TtlMs: 60_000 });
}

/**
 * Resolve one template key for a workspace. Built-ins short-circuit without a
 * query — opening the wizard for a built-in costs no database round-trip — and
 * the fallback order is the same one {@link listTemplatesForTenant} applies, so
 * the key that LISTS and the key that RESOLVES cannot be different manifests.
 */
export async function resolveTemplate(
  db: Db,
  tenantId: number,
  key: string,
  env?: Env,
): Promise<ResolvedTemplate | null> {
  const builtin = BUILTIN_TEMPLATES.get(key);
  if (builtin) return builtinResolved(builtin);
  const all = await listTemplatesForTenant(db, tenantId, env);
  return all.find((t) => t.manifest.key === key) ?? null;
}

/** A gallery card. Never the full manifest: a grid of forty templates does not
 *  need forty step lists, and shipping them makes the list response enormous. */
export interface TemplateSummary {
  key: string;
  name: string;
  summary: string;
  category: string;
  icon: string;
  tags: string[];
  origin: TemplateOrigin;
  /** Connector keys the template calls — the "works with" row on the card. */
  connectors: string[];
  /** How many of those the workspace has already connected. */
  connectedCount: number;
  stepCount: number;
  outputKinds: string[];
  installCount: number;
  priceCents: number | null;
  currency: string | null;
  publisherRef: string | null;
}

/**
 * Summarise the catalogue for the gallery.
 *
 * `connectedCount` is computed here rather than in the card because "3 of 4
 * connected" is the one number that decides whether somebody starts, and a card
 * that computed it from a prop-drilled set would be the second place that logic
 * lives.
 */
export function summarizeTemplates(
  entries: readonly ResolvedTemplate[],
  connectedConnectors: ReadonlySet<string>,
): TemplateSummary[] {
  return entries.map((e) => {
    const connectors = e.manifest.requiredConnectors.map((rc) => rc.key);
    return {
      key: e.manifest.key,
      name: e.manifest.name,
      summary: e.manifest.summary,
      category: e.manifest.category,
      icon: e.manifest.icon,
      tags: e.manifest.tags,
      origin: e.origin,
      connectors,
      connectedCount: connectors.filter((k) => connectedConnectors.has(k)).length,
      stepCount: e.manifest.steps.length,
      outputKinds: [...new Set(e.manifest.outputs.map((o) => o.kind))],
      installCount: e.installCount,
      priceCents: e.priceCents,
      currency: e.currency,
      publisherRef: e.publisherRef,
    };
  });
}

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
 * Reads go through the ONE templates store (`catalogTemplateStore.ts`), which
 * serves them from the shared read-through cache under version tokens every
 * template write bumps: the catalogue is hit on every gallery render and every
 * wizard open, and without the cache that is a table scan per page view.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  parseTemplateManifest,
  withDerivedConnectSteps,
  type TemplateManifest,
} from '../../domain/template/templateManifest';
import { BUILTIN_TEMPLATES, BUILTIN_TEMPLATE_LIST } from './defaults';
import { listPublicTemplates, listTenantTemplates } from './catalogTemplateStore';
import { TEMPLATE_KINDS, type StoredTemplate } from './templateKinds';

/** Where a manifest came from — drives "Built-in" / "Yours" / "Marketplace". */
export type TemplateOrigin = 'builtin' | 'tenant' | 'marketplace';

/** The `catalog_items.kind` a manifest template row carries. */
export const TEMPLATE_CATALOG_KIND = TEMPLATE_KINDS.manifest;

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
function rowToResolved(row: StoredTemplate, origin: TemplateOrigin): ResolvedTemplate | null {
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
      updatedAt: row.updatedAt,
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
async function loadTenantTemplates(db: Db, env: Env | undefined, tenantId: number): Promise<ResolvedTemplate[]> {
  const rows = await listTenantTemplates(db, env, { tenantId, kind: TEMPLATE_CATALOG_KIND });
  return rows.map((r) => rowToResolved(r, 'tenant')).filter((t): t is ResolvedTemplate => t !== null);
}

/**
 * Published marketplace templates — the platform-owned catalogue
 * (`tenant_id IS NULL`, listed public and published). The workspace's own
 * published rows are not repeated here: they are already in the tenant list,
 * where they can be edited. A signed-out visitor reads exactly this list.
 */
async function loadPublishedTemplates(db: Db, env: Env | undefined): Promise<ResolvedTemplate[]> {
  const rows = await listPublicTemplates(db, env, { kind: TEMPLATE_CATALOG_KIND, scope: 'platform', limit: 200 });
  return rows
    .map((r) => rowToResolved(r, 'marketplace'))
    .filter((t): t is ResolvedTemplate => t !== null);
}

/**
 * The full catalogue for a workspace — or, with `tenantId === null`, for a
 * signed-out visitor.
 *
 * A key collision resolves to the FIRST entry, and the order below is the
 * precedence stated in this module's header: built-in, then the workspace's own,
 * then published.
 *
 * THE CATALOGUE IS NOT A PRIVATE READ. What you can start from is the menu of
 * the product; a visitor who cannot see it cannot tell what this is. So a guest
 * gets the same list minus the halves that only exist inside a workspace — no
 * owned templates, and no cross-tenant widening. Installing is still gated, at
 * the install route, which is where the gate belongs (guest preview, session
 * gates ACTIONS).
 */
export async function listTemplatesForTenant(
  db: Db,
  tenantId: number | null,
  env?: Env,
): Promise<ResolvedTemplate[]> {
  // Independent reads (each cached by the store), so they overlap rather than queue.
  const [owned, published] = await Promise.all([
    tenantId === null ? Promise.resolve<ResolvedTemplate[]>([]) : loadTenantTemplates(db, env, tenantId),
    loadPublishedTemplates(db, env),
  ]);
  const claimed = new Set([...BUILTIN_TEMPLATES.keys(), ...owned.map((t) => t.manifest.key)]);
  return [
    ...BUILTIN_TEMPLATE_LIST.map(builtinResolved),
    ...owned,
    ...published.filter((t) => !claimed.has(t.manifest.key)),
  ];
}

/**
 * Resolve one template key for a workspace. Built-ins short-circuit without a
 * query — opening the wizard for a built-in costs no database round-trip — and
 * the fallback order is the same one {@link listTemplatesForTenant} applies, so
 * the key that LISTS and the key that RESOLVES cannot be different manifests.
 */
export async function resolveTemplate(
  db: Db,
  tenantId: number | null,
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

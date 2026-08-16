/**
 * Template write side — saving a workspace's own template and listing it on the
 * marketplace.
 *
 * Every write funnels through here so the three invariants that keep the
 * catalogue trustworthy hold in one place rather than per route:
 *   1. a manifest is VALIDATED before it is stored, and re-validated on edit;
 *   2. a workspace key can never shadow a built-in (`isReservedTemplateKey`);
 *   3. any write invalidates the catalogue cache, because a template that is
 *      saved but absent from the gallery for five minutes reads as data loss.
 *
 * Publishing is a VISIBILITY change on the row that already exists, not a second
 * table and not a copy. A template a workspace lists publicly is the same row
 * its owner keeps editing — which is what makes "update your published template"
 * an edit rather than a re-publish flow, and what stops the public copy drifting
 * from the private one.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems } from '../../infrastructure/database/schema';
import {
  parseTemplateManifest,
  TemplateManifestError,
  type TemplateManifest,
} from '../../domain/template/templateManifest';
import { isReservedTemplateKey } from './defaults';
import { invalidateTemplateCatalog, TEMPLATE_CATALOG_KIND } from './templateRegistry';

export class TemplateServiceError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: string[]) {
    super(message);
    this.name = 'TemplateServiceError';
  }
}

function validateOrThrow(raw: unknown): TemplateManifest {
  try {
    return parseTemplateManifest(raw);
  } catch (e) {
    if (e instanceof TemplateManifestError) {
      throw new TemplateServiceError('The template is not valid', 400, e.errors);
    }
    throw e;
  }
}

export interface SaveTemplateArgs {
  tenantId: number;
  manifest: unknown;
  publisherRef: string | null;
  /** List it publicly in the same write. Defaults to private. */
  publish?: boolean;
  priceCents?: number | null;
  currency?: string | null;
}

export interface SavedTemplate {
  id: string;
  key: string;
  visibility: string;
  manifest: TemplateManifest;
}

/**
 * Create or replace a workspace's template.
 *
 * Keyed by `(tenant, kind, slug)` — the unique index `catalog_items` already
 * carries — so saving the same key twice UPDATES rather than accumulating a
 * second row a person cannot tell apart from the first.
 */
export async function saveTemplate(db: Db, env: Env, args: SaveTemplateArgs): Promise<SavedTemplate> {
  const manifest = validateOrThrow(args.manifest);
  if (isReservedTemplateKey(manifest.key)) {
    throw new TemplateServiceError(
      `"${manifest.key}" is a built-in template — choose a different key (e.g. "${manifest.key}-custom")`,
      409,
    );
  }

  const visibility = args.publish ? 'public' : 'private';
  const now = new Date();
  const [existing] = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(and(
      eq(catalogItems.tenantId, args.tenantId),
      eq(catalogItems.kind, TEMPLATE_CATALOG_KIND),
      eq(catalogItems.slug, manifest.key),
    ))
    .limit(1);

  const values = {
    name: manifest.name.slice(0, 200),
    summary: manifest.summary,
    body: manifest as unknown as Record<string, unknown>,
    category: manifest.category,
    tags: manifest.tags,
    visibility,
    priceCents: args.priceCents ?? null,
    currency: args.currency ?? (args.priceCents ? 'usd' : null),
    publisherRef: args.publisherRef,
    // `isTemplate` is the template/instance flag `catalog_items` carries for the
    // whole kernel; a row of kind 'template' that did not set it would be
    // invisible to every generic surface that filters on it.
    isTemplate: true,
    ...(args.publish ? { publishedAt: now } : {}),
    updatedAt: now,
  };

  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await db.update(catalogItems).set(values).where(and(
      eq(catalogItems.id, existing.id),
      eq(catalogItems.tenantId, args.tenantId),
    ));
  } else {
    await db.insert(catalogItems).values({
      id,
      tenantId: args.tenantId,
      kind: TEMPLATE_CATALOG_KIND,
      slug: manifest.key,
      ...values,
      createdAt: now,
    });
  }

  await invalidateTemplateCatalog(env, args.tenantId);
  return { id, key: manifest.key, visibility, manifest };
}

/** List or unlist an existing template. Separate from {@link saveTemplate} so
 *  the storefront's toggle does not have to round-trip the whole manifest. */
export async function setTemplateVisibility(
  db: Db,
  env: Env,
  args: { tenantId: number; key: string; publish: boolean },
): Promise<{ visibility: string }> {
  const now = new Date();
  const result = await db
    .update(catalogItems)
    .set({
      visibility: args.publish ? 'public' : 'private',
      publishedAt: args.publish ? now : null,
      updatedAt: now,
    })
    .where(and(
      eq(catalogItems.tenantId, args.tenantId),
      eq(catalogItems.kind, TEMPLATE_CATALOG_KIND),
      eq(catalogItems.slug, args.key),
    ))
    .returning({ id: catalogItems.id });
  if (result.length === 0) throw new TemplateServiceError('Template not found', 404);
  await invalidateTemplateCatalog(env, args.tenantId);
  return { visibility: args.publish ? 'public' : 'private' };
}

export async function deleteTemplate(
  db: Db,
  env: Env,
  args: { tenantId: number; key: string },
): Promise<void> {
  if (isReservedTemplateKey(args.key)) {
    throw new TemplateServiceError('Built-in templates cannot be deleted', 409);
  }
  await db.delete(catalogItems).where(and(
    eq(catalogItems.tenantId, args.tenantId),
    eq(catalogItems.kind, TEMPLATE_CATALOG_KIND),
    eq(catalogItems.slug, args.key),
  ));
  await invalidateTemplateCatalog(env, args.tenantId);
}

/**
 * Template write side — saving a workspace's own template and listing it on the
 * marketplace.
 *
 * Every write funnels through here so the three invariants that keep the
 * catalogue trustworthy hold in one place rather than per route:
 *   1. a manifest is VALIDATED before it is stored, and re-validated on edit;
 *   2. a workspace key can never shadow a built-in (`isReservedTemplateKey`);
 *   3. any write invalidates the catalogue cache (the store bumps its version
 *      token), because a template that is saved but absent from the gallery for
 *      five minutes reads as data loss.
 *
 * Publishing is a VISIBILITY change on the row that already exists, not a second
 * table and not a copy. A template a workspace lists publicly is the same row
 * its owner keeps editing — which is what makes "update your published template"
 * an edit rather than a re-publish flow, and what stops the public copy drifting
 * from the private one.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  parseTemplateManifest,
  TemplateManifestError,
  type TemplateManifest,
} from '../../domain/template/templateManifest';
import { isReservedTemplateKey } from './defaults';
import { outputKindSpec, uninstallableOutputError } from './outputKinds';
import { TEMPLATE_CATALOG_KIND } from './templateRegistry';
import { deleteTemplateRow, insertTemplate, updateTemplate, type TemplateValues } from './catalogTemplateStore';

export class TemplateServiceError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: string[]) {
    super(message);
    this.name = 'TemplateServiceError';
  }
}

function validateOrThrow(raw: unknown): TemplateManifest {
  let manifest: TemplateManifest;
  try {
    manifest = parseTemplateManifest(raw);
  } catch (e) {
    if (e instanceof TemplateManifestError) {
      throw new TemplateServiceError('The template is not valid', 400, e.errors);
    }
    throw e;
  }
  // The shape check above holds the manifest to the DOMAIN's kind list; this holds
  // it to what the registry can actually install, with the same sentence the
  // installer would otherwise emit — at publish time, not at a customer's install.
  const uninstallable = manifest.outputs.flatMap((output, index) =>
    outputKindSpec(output.kind) ? [] : [`outputs[${index}].kind: ${uninstallableOutputError(output.kind)}`]);
  if (uninstallable.length > 0) {
    throw new TemplateServiceError('The template is not valid', 400, uninstallable);
  }
  return manifest;
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
  const values: TemplateValues = {
    name: manifest.name.slice(0, 200),
    summary: manifest.summary,
    body: manifest,
    category: manifest.category,
    tags: manifest.tags,
    visibility,
    priceCents: args.priceCents ?? null,
    currency: args.currency ?? (args.priceCents ? 'usd' : null),
    publisherRef: args.publisherRef,
    ...(args.publish ? { publishedAt: new Date() } : {}),
  };

  // Keyed by (tenant, kind, slug): update the row under this key if there is one,
  // otherwise insert it.
  const target = { tenantId: args.tenantId, kind: TEMPLATE_CATALOG_KIND };
  const id = (await updateTemplate(db, env, { ...target, match: { slug: manifest.key }, values }))
    ?? (await insertTemplate(db, env, { ...target, values: { ...values, slug: manifest.key, name: manifest.name.slice(0, 200) } }));

  return { id, key: manifest.key, visibility, manifest };
}

/** List or unlist an existing template. Separate from {@link saveTemplate} so
 *  the storefront's toggle does not have to round-trip the whole manifest. */
export async function setTemplateVisibility(
  db: Db,
  env: Env,
  args: { tenantId: number; key: string; publish: boolean },
): Promise<{ visibility: string }> {
  const found = await updateTemplate(db, env, {
    tenantId: args.tenantId,
    kind: TEMPLATE_CATALOG_KIND,
    match: { slug: args.key },
    values: {
      visibility: args.publish ? 'public' : 'private',
      publishedAt: args.publish ? new Date() : null,
    },
  });
  if (!found) throw new TemplateServiceError('Template not found', 404);
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
  await deleteTemplateRow(db, env, { tenantId: args.tenantId, kind: TEMPLATE_CATALOG_KIND, match: { slug: args.key } });
}

/**
 * The template KINDS `catalog_items` carries, and the row shape every template
 * reader sees. Split out of `catalogTemplateStore.ts` so the vocabulary (and the
 * generic entity reader's row filter) can be imported without the store's
 * queries and cache.
 */
import { and, eq, not, type SQL } from 'drizzle-orm';
import { catalogItems } from '../../infrastructure/database/schema';

/** The `catalog_items.kind` values a template row carries. */
export const TEMPLATE_KINDS = {
  /** A guided-setup template manifest (`/api/templates`). */
  manifest: 'template',
  /** A kanban board definition — lanes + per-lane requirements (`/api/kanban/templates`). */
  kanban: 'kanban_template',
  /** A reusable canvas graph (`/api/creation-sessions/templates`). */
  canvas: 'canvas_template',
} as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[keyof typeof TEMPLATE_KINDS];

export type TemplateVisibilityValue = 'private' | 'tenant' | 'public';

/** A template row as every caller sees it — JSON-safe, so it caches as-is. */
export interface StoredTemplate {
  id: string;
  tenantId: number | null;
  segmentId: string | null;
  kind: string;
  slug: string;
  name: string;
  summary: string | null;
  body: unknown;
  category: string | null;
  tags: unknown;
  version: string;
  visibility: string;
  priceCents: number | null;
  currency: string | null;
  publisherRef: string | null;
  installCount: number;
  createdBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type CatalogRow = typeof catalogItems.$inferSelect;

const iso = (d: Date | string | null): string | null =>
  d === null ? null : typeof d === 'string' ? d : d.toISOString();

/** Pure: a drizzle row → the cacheable shape. Exported for the tests. */
export function toStoredTemplate(row: CatalogRow): StoredTemplate {
  return {
    id: row.id,
    tenantId: row.tenantId,
    segmentId: row.segmentId,
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    body: row.body,
    category: row.category,
    tags: row.tags,
    version: row.version,
    visibility: row.visibility,
    priceCents: row.priceCents,
    currency: row.currency,
    publisherRef: row.publisherRef,
    installCount: row.installCount,
    createdBy: row.createdBy,
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

/** Narrow a stored visibility to the three values the template kinds use. */
export function templateVisibility(value: string): TemplateVisibilityValue {
  return value === 'public' || value === 'tenant' ? value : 'private';
}

/**
 * The `catalog_items` rows the generic entity reader (`/:domain/entities`) may
 * return: everything except a PRIVATE canvas template, which is its author's alone
 * (migration 1263) — only `creation/canvasTemplates.ts` knows who is asking, so
 * those rows are reachable through it and nowhere else.
 */
export const CATALOG_BROWSABLE_ROWS: SQL = not(and(
  eq(catalogItems.kind, TEMPLATE_KINDS.canvas),
  eq(catalogItems.visibility, 'private'),
) as SQL);

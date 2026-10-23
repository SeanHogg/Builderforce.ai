/**
 * Canvas templates — a workspace's reusable creation-session graphs.
 *
 * A canvas template is a `catalog_items` row of kind 'canvas_template'
 * (migration 1263 folded `creation_session_templates` in), read and written
 * through the ONE templates store. This module owns only what is canvas-specific:
 * the segment scoping, the audience rule ('tenant' = everyone in the segment,
 * 'private' = its author only), and the response shape `/api/creation-sessions/
 * templates` has always returned — so the typed client and the canvas menu did
 * not have to change when the storage did.
 *
 * Built-in Marketplace packs remain code-signed catalog entries in the frontend.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  countTenantTemplates,
  deleteTemplateRow,
  getTenantTemplate,
  insertTemplate,
  listTenantTemplates,
} from '../templates/catalogTemplateStore';
import { TEMPLATE_KINDS, type StoredTemplate } from '../templates/templateKinds';

const KIND = TEMPLATE_KINDS.canvas;

export type CanvasTemplateVisibility = 'private' | 'tenant';

/** The wire shape of a canvas template (`CreationTemplate` in the frontend client). */
export interface CanvasTemplateView {
  id: string;
  name: string;
  description: string | null;
  category: string;
  visibility: CanvasTemplateVisibility;
  graph: unknown;
  createdBy: string | null;
  updatedAt: string;
}

/** Pure: a stored row → the wire shape. The graph lives in `body.graph`. */
export function canvasTemplateView(row: StoredTemplate): CanvasTemplateView {
  const body = row.body && typeof row.body === 'object' ? (row.body as Record<string, unknown>) : {};
  return {
    id: row.id,
    name: row.name,
    description: row.summary,
    category: row.category ?? 'Custom',
    visibility: row.visibility === 'tenant' ? 'tenant' : 'private',
    graph: body.graph ?? null,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  };
}

/** Pure: may `userId` see this template inside `segmentId`? */
export function canvasTemplateVisibleTo(row: StoredTemplate, segmentId: string, userId: string): boolean {
  return row.segmentId === segmentId && (row.visibility === 'tenant' || row.createdBy === userId);
}

interface Audience { tenantId: number; segmentId: string; userId: string }

/** The templates `userId` can start from in this segment, newest first. */
export async function listCanvasTemplates(db: Db, env: Env | undefined, args: Audience): Promise<CanvasTemplateView[]> {
  const rows = await listTenantTemplates(db, env, { tenantId: args.tenantId, kind: KIND, segmentId: args.segmentId });
  return rows.filter((r) => canvasTemplateVisibleTo(r, args.segmentId, args.userId)).map(canvasTemplateView);
}

/** One template `userId` can apply, or null. */
export async function getCanvasTemplate(
  db: Db,
  env: Env | undefined,
  args: Audience & { id: string },
): Promise<CanvasTemplateView | null> {
  const row = await getTenantTemplate(db, env, { tenantId: args.tenantId, kind: KIND, id: args.id });
  return row && canvasTemplateVisibleTo(row, args.segmentId, args.userId) ? canvasTemplateView(row) : null;
}

/** How many canvas templates the segment holds — the plan quota's numerator. */
export function countCanvasTemplates(db: Db, args: { tenantId: number; segmentId: string }): Promise<number> {
  return countTenantTemplates(db, { tenantId: args.tenantId, kind: KIND, segmentId: args.segmentId });
}

export async function createCanvasTemplate(
  db: Db,
  env: Env | undefined,
  args: Audience & {
    name: string;
    description: string | null;
    category: string;
    visibility: CanvasTemplateVisibility;
    graph: unknown;
  },
): Promise<{ id: string; name: string }> {
  const id = crypto.randomUUID();
  await insertTemplate(db, env, {
    tenantId: args.tenantId,
    kind: KIND,
    id,
    values: {
      // A canvas template has no human key; its id is unique by construction.
      slug: `canvas-${id}`,
      name: args.name,
      summary: args.description,
      category: args.category,
      visibility: args.visibility,
      segmentId: args.segmentId,
      createdBy: args.userId,
      body: { graph: args.graph, updatedBy: args.userId },
    },
  });
  return { id, name: args.name };
}

/** Delete a template its author owns. Returns false when it is not theirs (or gone). */
export async function deleteOwnCanvasTemplate(db: Db, env: Env | undefined, args: Audience & { id: string }): Promise<boolean> {
  const row = await getTenantTemplate(db, env, { tenantId: args.tenantId, kind: KIND, id: args.id });
  if (!row || row.segmentId !== args.segmentId || row.createdBy !== args.userId) return false;
  return deleteTemplateRow(db, env, { tenantId: args.tenantId, kind: KIND, match: { id: args.id } });
}

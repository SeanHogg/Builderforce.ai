/**
 * The canvas widget REGISTRY — the server half of the third-party widget runtime.
 *
 * Registration is the whole security model. Once a widget is in this table the
 * browser host will mount its entry URL in a frame and accept `postMessage` traffic
 * from exactly one origin with exactly one permission set, so everything that
 * decides those two facts happens here, once, and never at render time:
 *
 *   · `entryOrigin` is DERIVED from `entryUrl` by `widgetEntryOrigin` — https only,
 *     with a loopback exception for local development. A caller cannot supply it.
 *   · `permissions` is filtered to the closed vocabulary and stored in canonical
 *     order, so two registrations of the same grant compare equal and an upgrade
 *     diff shows the change rather than a reshuffle.
 *
 * Writes live here rather than in the generic entity layer for exactly that reason:
 * a generic PATCH that could set `entry_origin` directly would let a caller point a
 * live widget's trust anchor at an origin nobody reviewed. See the `readOnly` note
 * in `domains/canvas/entities.ts`.
 *
 * The registry read is cached under a tenant version token — the board host resolves
 * a widget on every mount, so it is read far more often than it is written, and this
 * service is its ONLY writer, which makes the invalidation exact.
 */

import { desc, eq } from 'drizzle-orm';
import {
  validateWidgetManifest,
  widgetEntryOrigin,
  type CanvasWidgetManifest,
} from '@builderforce/canvas-widget-protocol';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { canvasWidgets } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';

export type CanvasWidgetRow = typeof canvasWidgets.$inferSelect;

export interface CanvasWidgetView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  entryUrl: string;
  /** The ONLY origin the host accepts messages from. Derived, never supplied. */
  entryOrigin: string;
  iconUrl: string | null;
  permissions: string[];
  version: string;
  width: number;
  height: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function widgetView(row: CanvasWidgetRow): CanvasWidgetView {
  return {
    id: row.id,
    key: row.widgetKey,
    name: row.name,
    description: row.description,
    entryUrl: row.entryUrl,
    entryOrigin: row.entryOrigin,
    iconUrl: row.iconUrl,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    version: row.version,
    width: row.defaultWidth,
    height: row.defaultHeight,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function widgetsVersionKey(tenantId: number): string {
  return `canvas-widgets-version:tenant:${tenantId}`;
}

export type WidgetWriteResult =
  | { ok: true; widget: CanvasWidgetView; created: boolean }
  | { ok: false; error: string; status: 400 | 404 | 409 };

/**
 * Register a widget, or update the registration that already holds this `key`.
 *
 * UPSERT rather than create-then-update, because the caller is a CI job publishing
 * a version and it must be able to run twice. The unique index on
 * (tenant_id, widget_key) is what makes that safe under concurrency, which is why
 * the conflict target is the index and not a preceding SELECT.
 */
export async function registerCanvasWidget(
  db: Db,
  env: Env,
  args: { tenantId: number; keyId: string | null; manifest: unknown },
): Promise<WidgetWriteResult> {
  const parsed = validateWidgetManifest(args.manifest);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const manifest: CanvasWidgetManifest = parsed.manifest;

  const values = {
    tenantId: args.tenantId,
    widgetKey: manifest.key,
    name: manifest.name,
    description: manifest.description,
    entryUrl: manifest.entryUrl,
    entryOrigin: manifest.entryOrigin,
    iconUrl: manifest.iconUrl,
    permissions: manifest.permissions as string[],
    version: manifest.version,
    defaultWidth: manifest.width,
    defaultHeight: manifest.height,
    createdByKeyId: args.keyId,
  };

  const existing = await findCanvasWidgetByKey(db, args.tenantId, manifest.key);
  const [row] = await db
    .insert(canvasWidgets)
    .values(values)
    .onConflictDoUpdate({
      target: [canvasWidgets.tenantId, canvasWidgets.widgetKey],
      set: {
        name: values.name,
        description: values.description,
        entryUrl: values.entryUrl,
        entryOrigin: values.entryOrigin,
        iconUrl: values.iconUrl,
        permissions: values.permissions,
        version: values.version,
        defaultWidth: values.defaultWidth,
        defaultHeight: values.defaultHeight,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) return { ok: false, error: 'Could not register the widget', status: 409 };

  await bumpCacheVersion(env, widgetsVersionKey(args.tenantId));
  return { ok: true, widget: widgetView(row), created: !existing };
}

/** Enable/disable, or re-point the entry URL. A URL change re-derives the origin. */
export async function updateCanvasWidget(
  db: Db,
  env: Env,
  args: { tenantId: number; widgetId: string; entryUrl?: string; status?: string; iconUrl?: string | null },
): Promise<WidgetWriteResult> {
  const patch: Partial<typeof canvasWidgets.$inferInsert> = { updatedAt: new Date() };
  if (args.entryUrl !== undefined) {
    const origin = widgetEntryOrigin(args.entryUrl);
    if (!origin) return { ok: false, error: 'entryUrl must be an absolute https URL', status: 400 };
    patch.entryUrl = args.entryUrl;
    // Re-derived together with the URL, always. The two are one fact, and a
    // registration whose origin lags its URL is a frame we would accept messages
    // from an origin it no longer loads.
    patch.entryOrigin = origin;
  }
  if (args.status !== undefined) {
    if (args.status !== 'active' && args.status !== 'disabled') {
      return { ok: false, error: "status must be 'active' or 'disabled'", status: 400 };
    }
    patch.status = args.status;
  }
  if (args.iconUrl !== undefined) {
    if (args.iconUrl && !widgetEntryOrigin(args.iconUrl)) {
      return { ok: false, error: 'iconUrl must be an absolute https URL', status: 400 };
    }
    patch.iconUrl = args.iconUrl || null;
  }

  const [row] = await db
    .update(canvasWidgets)
    .set(patch)
    .where(scopedToTenant(canvasWidgets, args.tenantId, eq(canvasWidgets.id, args.widgetId)))
    .returning();
  if (!row) return { ok: false, error: 'Widget not found', status: 404 };

  await bumpCacheVersion(env, widgetsVersionKey(args.tenantId));
  return { ok: true, widget: widgetView(row), created: false };
}

export async function deleteCanvasWidget(
  db: Db,
  env: Env,
  args: { tenantId: number; widgetId: string },
): Promise<boolean> {
  const [row] = await db
    .delete(canvasWidgets)
    .where(scopedToTenant(canvasWidgets, args.tenantId, eq(canvasWidgets.id, args.widgetId)))
    .returning({ id: canvasWidgets.id });
  if (!row) return false;
  await bumpCacheVersion(env, widgetsVersionKey(args.tenantId));
  return true;
}

export async function findCanvasWidgetByKey(
  db: Db,
  tenantId: number,
  key: string,
): Promise<CanvasWidgetRow | null> {
  const [row] = await db
    .select()
    .from(canvasWidgets)
    .where(scopedToTenant(canvasWidgets, tenantId, eq(canvasWidgets.widgetKey, key)))
    .limit(1);
  return row ?? null;
}

/** One widget, by registry id, within the tenant. Used by the board host to resolve
 *  a placement's `resource_id` into an origin and a permission set. */
export async function getCanvasWidget(
  db: Db,
  env: Env,
  tenantId: number,
  widgetId: string,
): Promise<CanvasWidgetView | null> {
  const version = await getCacheVersion(env, widgetsVersionKey(tenantId));
  return getOrSetCached(env, `canvas:widget:${tenantId}:${widgetId}:v:${version}`, async () => {
    const [row] = await db
      .select()
      .from(canvasWidgets)
      .where(scopedToTenant(canvasWidgets, tenantId, eq(canvasWidgets.id, widgetId)))
      .limit(1);
    return row ? widgetView(row) : null;
  });
}

export async function listCanvasWidgets(
  db: Db,
  env: Env,
  tenantId: number,
  opts: { includeDisabled?: boolean } = {},
): Promise<CanvasWidgetView[]> {
  const version = await getCacheVersion(env, widgetsVersionKey(tenantId));
  return getOrSetCached(
    env,
    `canvas:widgets:${tenantId}:${opts.includeDisabled ? 'all' : 'active'}:v:${version}`,
    async () => {
      const rows = await db
        .select()
        .from(canvasWidgets)
        .where(opts.includeDisabled
          ? scopedToTenant(canvasWidgets, tenantId)
          : scopedToTenant(canvasWidgets, tenantId, eq(canvasWidgets.status, 'active')))
        .orderBy(desc(canvasWidgets.updatedAt))
        .limit(200);
      return rows.map(widgetView);
    },
  );
}

/** Exported for the host: the predicate "may this frame speak to us at all". A
 *  disabled widget is not merely hidden — its messages are refused. */
export function widgetAcceptsOrigin(widget: CanvasWidgetView, origin: string): boolean {
  return widget.status === 'active' && Boolean(widget.entryOrigin) && widget.entryOrigin === origin;
}

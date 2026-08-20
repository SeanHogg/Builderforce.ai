/**
 * `/api/v1/widgets` — registration for third-party canvas widgets, and the
 * protocol contract a widget author codes against.
 *
 * ── THE CONTRACT IS SERVED, NOT JUST DOCUMENTED ──────────────────────────────────
 * `GET /api/v1/widgets/protocol` returns the sandbox attribute, the two message-type
 * allowlists, the permission each inbound type requires, and the envelope. It is
 * generated from `@builderforce/canvas-widget-protocol` — the same module the
 * browser host enforces with — so an author cannot be reading a stale list. A
 * protocol described only in a docs page is a protocol that drifts from the code
 * that implements it, and the drift is always discovered by a widget that stops
 * working in production.
 *
 * ── WHAT THIS SURFACE DOES NOT DO ────────────────────────────────────────────────
 * It does not place a widget on a board. That is an ITEM — `POST /boards/:id/items`
 * with `resourceType: 'canvas_widget'` and the registry id as `resourceId` — which
 * means placement, geometry, z-order, locking and the revision protocol come from
 * the canvas graph and not from a second half-model here. The canvas service
 * verifies that such a placement names a widget this workspace actually registered.
 */

import { Hono } from 'hono';
import {
  CANVAS_WIDGET_ALLOW,
  CANVAS_WIDGET_PERMISSIONS,
  CANVAS_WIDGET_PROTOCOL_VERSION,
  CANVAS_WIDGET_REFERRER_POLICY,
  CANVAS_WIDGET_RESOURCE_TYPE,
  CANVAS_WIDGET_SANDBOX,
  HOST_TO_WIDGET_MESSAGE_TYPES,
  WIDGET_CHANNEL,
  WIDGET_MESSAGE_PERMISSION,
  WIDGET_TO_HOST_MESSAGE_TYPES,
} from '@builderforce/canvas-widget-protocol';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import {
  deleteCanvasWidget,
  getCanvasWidget,
  listCanvasWidgets,
  registerCanvasWidget,
  updateCanvasWidget,
} from '../canvas/canvasWidgetService';
import { CANVAS_WEBHOOK_EVENTS } from '../seams/webhookService';
import { requirePublicApiKey } from './publicApiAuth';
import { touchTenantApiKey } from '../llm/tenantApiKeyService';
import { CREATION_UUID_RE as UUID_RE } from '../creation/creationGraphWriter';

/**
 * The full protocol contract, as data.
 *
 * Every field here is read from the shared module rather than restated, including
 * the sandbox string — the one value where a copy that drifts would silently hand a
 * third-party frame our own origin.
 */
export const WIDGET_PROTOCOL_SPEC = {
  version: CANVAS_WIDGET_PROTOCOL_VERSION,
  channel: WIDGET_CHANNEL,
  frame: {
    sandbox: CANVAS_WIDGET_SANDBOX,
    allow: CANVAS_WIDGET_ALLOW,
    referrerPolicy: CANVAS_WIDGET_REFERRER_POLICY,
    note: "The frame is NEVER granted allow-same-origin alongside allow-scripts. A widget that needs same-origin access to the host document is asking to be an extension, not a widget.",
  },
  envelope: {
    shape: { channel: WIDGET_CHANNEL, protocol: CANVAS_WIDGET_PROTOCOL_VERSION, type: '<message type>', requestId: '<optional, echoed on the reply>', payload: '<type-specific>' },
    note: 'A message whose channel, protocol version, origin or type does not match is dropped without being parsed. The origin is checked against the registered entryOrigin before the type is even looked at.',
  },
  messages: {
    widgetToHost: WIDGET_TO_HOST_MESSAGE_TYPES,
    hostToWidget: HOST_TO_WIDGET_MESSAGE_TYPES,
    /** Which grant each inbound type needs. `null` = none. */
    requiredPermission: WIDGET_MESSAGE_PERMISSION,
  },
  permissions: CANVAS_WIDGET_PERMISSIONS,
  placement: {
    resourceType: CANVAS_WIDGET_RESOURCE_TYPE,
    note: "Place a widget by creating a board item whose resourceType is 'canvas_widget' and whose resourceId is the widget's registry id.",
    endpoint: 'POST /api/v1/boards/{boardId}/items',
  },
  events: CANVAS_WEBHOOK_EVENTS,
} as const;

export function createPublicWidgetRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  async function auth(
    c: Parameters<Parameters<typeof router.get>[1]>[0],
    scope: 'read:canvas' | 'manage:widgets',
  ) {
    const resolved = await requirePublicApiKey(
      db, c.req.header('Authorization'), c.req.header('Origin') ?? null, scope,
    );
    if (resolved.ok) c.executionCtx.waitUntil(touchTenantApiKey(db, resolved.keyId));
    return resolved;
  }

  /** GET /api/v1/widgets/protocol — the contract, generated from the shared module. */
  router.get('/widgets/protocol', async (c) => {
    const resolved = await auth(c, 'read:canvas');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    return c.json(WIDGET_PROTOCOL_SPEC);
  });

  /** GET /api/v1/widgets — this workspace's registered widgets. */
  router.get('/widgets', async (c) => {
    const resolved = await auth(c, 'read:canvas');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const widgets = await listCanvasWidgets(db, c.env, resolved.tenantId, {
      includeDisabled: c.req.query('status') === 'all',
    });
    return c.json({ widgets, total: widgets.length });
  });

  /** GET /api/v1/widgets/:id */
  router.get('/widgets/:id', async (c) => {
    const resolved = await auth(c, 'read:canvas');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const id = c.req.param('id');
    // Same-shaped 404 for a malformed id, an unknown id and another tenant's id.
    if (!UUID_RE.test(id)) return c.json({ error: 'Widget not found' }, 404);
    const widget = await getCanvasWidget(db, c.env, resolved.tenantId, id);
    if (!widget) return c.json({ error: 'Widget not found' }, 404);
    return c.json({ widget });
  });

  /** POST /api/v1/widgets — register, or re-publish under the same `key`. */
  router.post('/widgets', async (c) => {
    const resolved = await auth(c, 'manage:widgets');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const manifest = await c.req.json().catch(() => null);
    const result = await registerCanvasWidget(db, c.env, {
      tenantId: resolved.tenantId,
      keyId: resolved.keyId,
      manifest,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ widget: result.widget }, result.created ? 201 : 200);
  });

  /** PATCH /api/v1/widgets/:id — re-point the entry URL, or disable it. */
  router.patch('/widgets/:id', async (c) => {
    const resolved = await auth(c, 'manage:widgets');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Widget not found' }, 404);
    const body = await c.req.json<{ entryUrl?: string; status?: string; iconUrl?: string | null }>()
      .catch(() => ({} as { entryUrl?: string; status?: string; iconUrl?: string | null }));
    const result = await updateCanvasWidget(db, c.env, {
      tenantId: resolved.tenantId, widgetId: id,
      entryUrl: body.entryUrl, status: body.status, iconUrl: body.iconUrl,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ widget: result.widget });
  });

  /** DELETE /api/v1/widgets/:id — deregister. Existing placements survive as
   *  objects and render as an unavailable card; deleting the row is not a way to
   *  silently rewrite somebody's board. */
  router.delete('/widgets/:id', async (c) => {
    const resolved = await auth(c, 'manage:widgets');
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Widget not found' }, 404);
    const removed = await deleteCanvasWidget(db, c.env, { tenantId: resolved.tenantId, widgetId: id });
    if (!removed) return c.json({ error: 'Widget not found' }, 404);
    return c.json({ ok: true, id });
  });

  return router;
}

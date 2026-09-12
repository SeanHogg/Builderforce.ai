/**
 * The board HOST's read of a third-party widget — session-authenticated.
 *
 *   GET /api/creation-sessions/:id/widgets/:widgetId   resolve one placement's widget  [session member]
 *
 * ── WHY NOT `/api/v1/widgets/:id` ─────────────────────────────────────────────────
 * That route is the INTEGRATOR's: it authenticates with a `bfk_` key and answers for
 * the key's workspace. The browser rendering a board has a person's session, not a
 * key, and the question it asks is narrower — "this board has a `canvas_widget`
 * placement; what URL do I frame, which origin do I trust, what was it granted?" — so
 * it is answered THROUGH THE BOARD: a person who is not a member of the board cannot
 * resolve its widgets, and the registry read is scoped to the board's own tenant
 * (which, for a superadmin added to an associate's board, is not the viewer's).
 *
 * A disabled widget resolves as not found. The host would refuse its messages anyway
 * (`widgetAcceptsOrigin`), and a frame whose every message is refused is a rectangle
 * that looks alive and is not — the one thing a host must not mount.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { resolveSessionAccess } from '../../application/creation/sessionAccess';
import { getCanvasWidget, widgetAcceptsOrigin } from '../../application/canvas/canvasWidgetService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createCanvasWidgetHostRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/:id/widgets/:widgetId', async (c) => {
    const sessionId = c.req.param('id') ?? '';
    const widgetId = c.req.param('widgetId') ?? '';
    // One shape of 404 for a malformed id, a board you cannot open, an unknown widget,
    // another tenant's widget and a disabled one — none of them is worth telling apart
    // to somebody probing.
    if (!UUID_RE.test(sessionId) || !UUID_RE.test(widgetId)) return c.json({ error: 'Widget not found' }, 404);
    const access = await resolveSessionAccess(db, sessionId, c.get('tenantId') as number, c.get('userId') as string);
    if (!access) return c.json({ error: 'Widget not found' }, 404);
    const widget = await getCanvasWidget(db, c.env as Env, access.session.tenantId, widgetId);
    if (!widget || !widgetAcceptsOrigin(widget, widget.entryOrigin)) return c.json({ error: 'Widget not found' }, 404);
    return c.json({
      widget: {
        id: widget.id,
        key: widget.key,
        name: widget.name,
        description: widget.description,
        entryUrl: widget.entryUrl,
        entryOrigin: widget.entryOrigin,
        iconUrl: widget.iconUrl,
        permissions: widget.permissions,
        version: widget.version,
        width: widget.width,
        height: widget.height,
        status: widget.status,
      },
    });
  });

  return router;
}

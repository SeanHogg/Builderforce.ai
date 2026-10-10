/**
 * `GET /api/creation-sessions/:id/widgets/:widgetId` — the board HOST's read of a
 * third-party widget.
 *
 * The route answers THROUGH THE BOARD: membership decides whether the widget can be
 * resolved at all, the registry read is scoped to the BOARD's tenant (not the
 * viewer's), and every refusal — malformed id, no access, unknown widget, a disabled
 * one — is the same 404 so a probe learns nothing. These pin each of those, plus the
 * exact projection that crosses the wire (no `createdAt`/`updatedAt`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const VIEWER_TENANT = 7;
const BOARD_TENANT = 42;
const USER = 'user-1';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', VIEWER_TENANT);
    c.set('userId', USER);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

const resolveSessionAccess = vi.fn();
vi.mock('../../application/creation/sessionAccess', () => ({
  resolveSessionAccess: (...args: unknown[]) => resolveSessionAccess(...args),
}));

const getCanvasWidget = vi.fn();
vi.mock('../../application/canvas/canvasWidgetService', async () => ({
  // The origin predicate stays REAL — it is the shared protocol rule the browser host
  // applies too, and a disabled widget must resolve as not found because of it.
  widgetAcceptsOrigin: (await import('@builderforce/canvas-widget-protocol')).widgetAcceptsOrigin,
  getCanvasWidget: (...args: unknown[]) => getCanvasWidget(...args),
}));

const { createCanvasWidgetHostRoutes } = await import('./canvasWidgetHostRoutes');

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const WIDGET_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ENV = { tag: 'env' };
const DB = { tag: 'db' };

const widget = (overrides: Record<string, unknown> = {}) => ({
  id: WIDGET_ID,
  key: 'kanban-lite',
  name: 'Kanban Lite',
  description: 'A tiny board',
  entryUrl: 'https://widgets.example.com/kanban/index.html',
  entryOrigin: 'https://widgets.example.com',
  iconUrl: null,
  permissions: ['board:read'],
  version: '1.2.0',
  width: 480,
  height: 320,
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  ...overrides,
});

async function get(sessionId = SESSION_ID, widgetId = WIDGET_ID) {
  const app = createCanvasWidgetHostRoutes(DB as never);
  const res = await app.request(`/${sessionId}/widgets/${widgetId}`, {}, ENV);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  resolveSessionAccess.mockReset();
  getCanvasWidget.mockReset();
  resolveSessionAccess.mockResolvedValue({ session: { tenantId: BOARD_TENANT }, role: 'viewer' });
  getCanvasWidget.mockResolvedValue(widget());
});

describe('GET /:id/widgets/:widgetId', () => {
  it('resolves the widget for a board member, projecting only the host fields', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toEqual({
      widget: {
        id: WIDGET_ID,
        key: 'kanban-lite',
        name: 'Kanban Lite',
        description: 'A tiny board',
        entryUrl: 'https://widgets.example.com/kanban/index.html',
        entryOrigin: 'https://widgets.example.com',
        iconUrl: null,
        permissions: ['board:read'],
        version: '1.2.0',
        width: 480,
        height: 320,
        status: 'active',
      },
    });
  });

  it("checks access as the caller, then reads the registry in the BOARD's tenant", async () => {
    await get();
    expect(resolveSessionAccess).toHaveBeenCalledWith(DB, SESSION_ID, VIEWER_TENANT, USER);
    expect(getCanvasWidget).toHaveBeenCalledWith(DB, ENV, BOARD_TENANT, WIDGET_ID);
  });

  it.each([
    ['a malformed session id', 'not-a-uuid', WIDGET_ID],
    ['a malformed widget id', SESSION_ID, 'nope'],
  ])('404s %s without touching access or the registry', async (_label, sessionId, widgetId) => {
    const { status, body } = await get(sessionId, widgetId);
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Widget not found' });
    expect(resolveSessionAccess).not.toHaveBeenCalled();
    expect(getCanvasWidget).not.toHaveBeenCalled();
  });

  it('404s a board the caller cannot open, and never reads the registry', async () => {
    resolveSessionAccess.mockResolvedValue(null);
    const { status, body } = await get();
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Widget not found' });
    expect(getCanvasWidget).not.toHaveBeenCalled();
  });

  it('404s an unknown (or another tenant\'s) widget', async () => {
    getCanvasWidget.mockResolvedValue(null);
    const { status, body } = await get();
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Widget not found' });
  });

  it('404s a disabled widget — a frame whose every message is refused must not mount', async () => {
    getCanvasWidget.mockResolvedValue(widget({ status: 'disabled' }));
    const { status } = await get();
    expect(status).toBe(404);
  });

  it('404s a widget with no registered origin', async () => {
    getCanvasWidget.mockResolvedValue(widget({ entryOrigin: '' }));
    const { status } = await get();
    expect(status).toBe(404);
  });
});

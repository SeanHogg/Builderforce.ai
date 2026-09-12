/**
 * Third-party canvas widgets, as the board's HOST reads them.
 *
 * Server counterpart: `api/src/presentation/routes/canvasWidgetHostRoutes.ts`.
 *
 * One read and no write. A widget is registered by its integrator through
 * `/api/v1/widgets` with an API key; a board only ever needs to turn a placement's
 * `canvas_widget:<id>` into the entry URL, the origin it may trust and the permissions
 * an admin approved — and it asks through the SESSION, so a person who cannot open the
 * board cannot resolve its widgets either.
 */

import { apiRequest } from './apiClient';

export interface CanvasWidgetRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  entryUrl: string;
  /** The ONLY origin the host accepts messages from. Derived by the server, never supplied. */
  entryOrigin: string;
  iconUrl: string | null;
  permissions: string[];
  version: string;
  width: number;
  height: number;
  status: string;
}

export const canvasWidgetApi = {
  resolve: (sessionId: string, widgetId: string) =>
    apiRequest<{ widget: CanvasWidgetRecord }>(
      `/api/creation-sessions/${encodeURIComponent(sessionId)}/widgets/${encodeURIComponent(widgetId)}`,
      // A placement whose widget was deregistered or disabled is an ordinary state of a
      // board, not an incident: the host renders nothing for it.
      { expectedErrors: [403, 404] },
    ),
};

const cache = new Map<string, Promise<CanvasWidgetRecord | null>>();

/**
 * Resolve once per page for every surface that shows the placement — the flat card
 * and the room's stand draw the same widget and must not fetch it twice. A failure
 * resolves to null and is forgotten, so the next mount asks again.
 */
export function resolveCanvasWidget(sessionId: string, widgetId: string): Promise<CanvasWidgetRecord | null> {
  const key = `${sessionId}:${widgetId}`;
  const known = cache.get(key);
  if (known) return known;
  const pending = canvasWidgetApi.resolve(sessionId, widgetId)
    .then(({ widget }) => (widget && widget.status === 'active' ? widget : null))
    .catch(() => {
      cache.delete(key);
      return null;
    });
  cache.set(key, pending);
  return pending;
}

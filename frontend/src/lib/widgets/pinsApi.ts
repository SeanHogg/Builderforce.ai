import { apiRequest } from '../apiClient';

/**
 * Per-user widget pins — client mirror of api/.../dashboardPinsRoutes.ts
 * (mounted at /api/dashboard-pins).
 *
 * A "pin" is a personal favourite: the registry widget id a user wants on their
 * own /insights home dashboard. Pins are scoped to (tenant, user) so each member
 * curates their own home without touching the tenant-shared dashboards. No
 * manager gate — pinning is a personal action.
 */

export interface WidgetPin {
  widgetKey: string;
  position: number;
}

export const pinsApi = {
  list: (): Promise<{ pins: WidgetPin[] }> => apiRequest('/api/dashboard-pins'),

  pin: (widgetKey: string): Promise<WidgetPin> =>
    apiRequest('/api/dashboard-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetKey }),
    }),

  unpin: (widgetKey: string): Promise<{ deleted: string }> =>
    apiRequest(`/api/dashboard-pins/${encodeURIComponent(widgetKey)}`, { method: 'DELETE' }),

  reorder: (order: string[]): Promise<{ pins: WidgetPin[] }> =>
    apiRequest('/api/dashboard-pins/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    }),
};

import { apiRequest } from './apiClient';
import type { NavigationFeatureId } from './navigationFeatures';

interface NavigationFeaturesResponse { enabled: NavigationFeatureId[] }

export function getNavigationFeatures(tenantId: string): Promise<NavigationFeaturesResponse> {
  return apiRequest(`/api/tenants/${tenantId}/navigation-features`);
}

export function saveNavigationFeatures(
  tenantId: string,
  enabled: readonly NavigationFeatureId[],
): Promise<NavigationFeaturesResponse> {
  return apiRequest(`/api/tenants/${tenantId}/navigation-features`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

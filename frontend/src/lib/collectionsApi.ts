import { apiRequest } from '@/lib/apiClient';
import type { BulkEntityKey } from '../components/collection/descriptor';
import type { BulkRequest, BulkResult } from '../components/collection/collectionTypes';

/**
 * Typed client over the `apiRequest` transport for the ONE bulk endpoint
 * (PRD 47 §3). Every bulk action — delete / archive / restore / merge, any
 * count — is a single `POST /api/collections/:entity/bulk`, never a per-id
 * fan-out (that fan-out was the 429 in F6).
 */
export async function bulk(
  entity: BulkEntityKey,
  request: BulkRequest,
): Promise<BulkResult> {
  return apiRequest<BulkResult>(`/api/collections/${encodeURIComponent(entity)}/bulk`, {
    method: 'POST',
    body: JSON.stringify(request),
    auth: 'web',
  });
}

export const collectionsApi = { bulk };
export default collectionsApi;

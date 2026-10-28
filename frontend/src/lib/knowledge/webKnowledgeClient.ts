/**
 * The knowledge API client on the web, over THE frontend transport (`apiRequestStream`:
 * the workspace credential, the platform gate, the 401/402 handling and failure
 * reporting) — no second fetch wrapper. The client owns paths, bounds and error mapping
 * (`@builderforce/knowledge-client`); the statuses it maps itself are not toasted.
 */

import { createKnowledgeClient, type KnowledgeClient, type KnowledgeFetch } from '@builderforce/knowledge-client';
import { apiRequestStream } from '@/lib/apiClient';

/** Statuses the knowledge client turns into a typed result (404 → null/miss, 4xx → KnowledgeApiError). */
const HANDLED_BY_CLIENT = [400, 403, 404, 409, 413, 422];

export const webKnowledgeFetch: KnowledgeFetch = (path, init = {}) => {
  const { headers, ...rest } = init;
  return apiRequestStream(path, {
    ...rest,
    ...(headers ? { headers: Object.fromEntries(new Headers(headers).entries()) } : {}),
    expectedErrors: HANDLED_BY_CLIENT,
  });
};

export function createWebKnowledgeClient(projectId: number): KnowledgeClient {
  return createKnowledgeClient({ projectId, fetch: webKnowledgeFetch });
}

/**
 * Run delta client (PRD 41 §C11, §C14): what an agent run changed, as stored by the API.
 *
 *  - `GET /api/projects/:projectId/run-deltas?limit=&cursor=` → a project's history, one `RunDeltaSummary` per run ×
 *    repository, newest first, paged by an opaque cursor;
 *  - `GET /api/run-deltas/:runId` → a run's full deltas (`StoredRunDelta`, one per repository it touched).
 *
 * The types are the engine's own (`@builderforce/run-delta`), never a mirror. A 403/404 is "not available here" (no
 * entitlement, an unknown project or run), which the surfaces render as nothing, so it raises no global error toast.
 */

import type { RunDeltaSummary, StoredRunDelta } from '@builderforce/run-delta';
import { ApiRequestError, apiRequest, isSignedOutFailure } from './apiClient';

export type { RunDeltaSummary, StoredRunDelta };

export interface RunDeltaPage {
  items: RunDeltaSummary[];
  nextCursor?: string;
}

/** Statuses that mean "this surface does not apply here", not a fault. */
const NOT_AVAILABLE = [403, 404];

/** A cloud execution's id in the shared run-id space: spelled once, in the engine package (the API reads the same). */
export { cloudRunId } from '@builderforce/run-delta/run-ids';

/** True when the rejection means the run delta surface is not available (not entitled, unknown project or run). */
export function isRunDeltaUnavailable(error: unknown): boolean {
  if (isSignedOutFailure(error)) return true;
  // By shape, not only by class: a second copy of the transport module (a test double, a split chunk) still answers.
  const status = error instanceof ApiRequestError ? error.status : (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && NOT_AVAILABLE.includes(status);
}

export async function listProjectRunDeltas(
  projectId: number | string,
  opts: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<RunDeltaPage> {
  const qs = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.cursor) qs.set('cursor', opts.cursor);
  const page = await apiRequest<RunDeltaPage>(`/api/projects/${encodeURIComponent(String(projectId))}/run-deltas?${qs}`, {
    expectedErrors: NOT_AVAILABLE,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return { items: Array.isArray(page?.items) ? page.items : [], ...(page?.nextCursor ? { nextCursor: page.nextCursor } : {}) };
}

export async function getRunDeltas(runId: string, opts: { signal?: AbortSignal } = {}): Promise<StoredRunDelta[]> {
  const res = await apiRequest<{ deltas: StoredRunDelta[] }>(`/api/run-deltas/${encodeURIComponent(runId)}`, {
    expectedErrors: NOT_AVAILABLE,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return Array.isArray(res?.deltas) ? res.deltas : [];
}

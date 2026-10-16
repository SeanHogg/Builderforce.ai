/**
 * The error-report outbox — owned by the service worker, like every network write.
 *
 * Durable (IndexedDB), batched to the door's 20-event cap, scoped to the workspace the
 * error happened in, and replayed on reconnect with its own `Idempotency-Key` (the door
 * answers a replay with its first response, so an error is never filed twice). 422 (no
 * project to file into) and 429 (the workspace's monthly cap) are settled outcomes, not
 * failures: dropped, not retried.
 */
import { createOutbox, type Outbox, type OutboxOnlineSignal, type OutboxStore } from '@builderforce/write-outbox';
import type { ApiClient } from '../api/apiClient';
import { CLIENT_REPORT_SOURCE } from '../config';
import { MAX_REPORT_EVENTS, type ClientErrorEvent } from './errorEvents';

export interface ErrorReportDeps {
  api: ApiClient;
  store: OutboxStore<ClientErrorEvent, string>;
  online: OutboxOnlineSignal;
  scope(): string | null;
}

/** One lane: Rovr files against the workspace's default collector (no project). */
export const REPORT_LANE = 'workspace';

const settled = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 422 || status === 429 || (typeof status === 'number' && status >= 400 && status < 500 && status !== 401 && status !== 408);
};

export function createErrorReports(deps: ErrorReportDeps): Outbox<ClientErrorEvent, string> {
  return createOutbox<ClientErrorEvent, string>({
    maxItems: MAX_REPORT_EVENTS,
    maxWaitMs: 2_000,
    maxEntries: 200,
    retry: { isPermanent: settled },
    store: deps.store,
    online: deps.online,
    scope: deps.scope,
    async send(_lane, events, ctx) {
      await deps.api.request('/api/quality-ingest/client-report', {
        method: 'POST',
        json: { source: CLIENT_REPORT_SOURCE, projectId: null, events },
        idempotencyKey: ctx.idempotencyKey,
        ...(ctx.scope !== undefined ? { asScope: ctx.scope } : {}),
      });
    },
  });
}

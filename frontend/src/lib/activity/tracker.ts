/**
 * Portal activity tracker — the "click sense" capture.
 *
 * A single module-level queue that any portal code can push audited engagement
 * signals into via `trackActivity(...)` — navigations, tool executions, ticket
 * lane moves, project updates, AI-agent interactions, etc. It is the shared write
 * outbox (`@builderforce/write-outbox`): batches of up to 25 go to
 * POST /api/activity/signals at most every 15 s, in order, plus a final flush on page
 * hide (see the ActivityTracker mount component). One import, no context plumbing, so
 * every surface reports the same way (DRY).
 *
 * Best-effort: capture never blocks or throws into the UI. Signals are attributed
 * to the signed-in user server-side; tenant is enriched here from the active
 * workspace so the resolver can map a signal to an engagement.
 */
import { createOutbox } from '@builderforce/write-outbox';
import { sendActivitySignals, type ActivitySignalInput } from '../freelance/engagements';
import { getStoredTenant, getStoredWebToken } from '../auth';

/** The portal's one activity stream. */
const PORTAL_STREAM = 'portal';

const signals = createOutbox<ActivitySignalInput>({
  maxItems: 25,
  maxWaitMs: 15_000,
  send: (_stream, batch) => sendActivitySignals(batch),
});

/** Push one activity signal. `source` defaults to 'portal'; tenant is auto-filled. */
export function trackActivity(kind: string, opts: Omit<ActivitySignalInput, 'kind'> = {}): void {
  if (!getStoredWebToken()) return; // only signed-in sessions are tracked
  const tenant = getStoredTenant();
  const tenantId = opts.tenantId ?? (tenant ? Number(tenant.id) : undefined);
  signals.enqueue(PORTAL_STREAM, {
    source: 'portal',
    kind,
    occurredAt: new Date().toISOString(),
    ...opts,
    tenantId: Number.isFinite(tenantId as number) ? (tenantId as number) : undefined,
  });
}

/** Send the queued signals now — on page hide (`final`) or unmount. */
export function flushActivity(opts?: { final?: boolean }): Promise<void> {
  return signals.flush(undefined, opts);
}

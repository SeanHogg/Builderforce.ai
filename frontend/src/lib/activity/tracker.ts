/**
 * Portal activity tracker — the "click sense" capture.
 *
 * A single module-level queue that any portal code can push audited engagement
 * signals into via `trackActivity(...)` — navigations, tool executions, ticket
 * lane moves, project updates, AI-agent interactions, etc. The queue is flushed in
 * batches to POST /api/activity/signals (see ActivityTracker mount component). One
 * import, no context plumbing, so every surface reports the same way (DRY).
 *
 * Best-effort: capture never blocks or throws into the UI. Signals are attributed
 * to the signed-in user server-side; tenant is enriched here from the active
 * workspace so the resolver can map a signal to an engagement.
 */
import { sendActivitySignals, type ActivitySignalInput } from '../freelancerApi';
import { getStoredTenant, getStoredWebToken } from '../auth';

let queue: ActivitySignalInput[] = [];

/** Push one activity signal. `source` defaults to 'portal'; tenant is auto-filled. */
export function trackActivity(kind: string, opts: Omit<ActivitySignalInput, 'kind'> = {}): void {
  if (!getStoredWebToken()) return; // only signed-in sessions are tracked
  const tenant = getStoredTenant();
  const tenantId = opts.tenantId ?? (tenant ? Number(tenant.id) : undefined);
  queue.push({
    source: 'portal',
    kind,
    occurredAt: new Date().toISOString(),
    ...opts,
    tenantId: Number.isFinite(tenantId as number) ? (tenantId as number) : undefined,
  });
  if (queue.length >= 25) void flushActivity();
}

/** Flush the queued signals now. Called on a timer + page-hide. */
export async function flushActivity(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  await sendActivitySignals(batch);
}

/**
 * Each application's signed worker egress policy (make.md › PRD 31 §4 W10, control 6), minted
 * before the application starts and handed to the runtime synchronously.
 *
 * The runtime asks `workerPolicy(applicationId)` when it opens an application's preview origin
 * and starts its process Workers, and puts the answer on their script URLs (`?policy=<id>`), so
 * the API serves that application's CSP. The question is synchronous; minting is a request — so
 * the run target mints first ({@link prepareWorkerPolicy}), and the runtime reads the cache
 * ({@link workerPolicyFor}). Keyed by the application id, which already names its project
 * (`app:<projectId>:<16 hex>`), and kept until shortly before it expires.
 *
 * A failed mint, or a policy bound to an origin other than the one the page will open (the
 * server's `originKey` differs from the runtime's `previewOriginKey`, e.g. the shared runtime
 * was booted for another project), leaves the application with NO policy: its Workers get the
 * most restrictive CSP and its service worker the default egress. Nothing is shown to the
 * person — the app still runs; it only cannot reach external APIs it declared.
 */
import { recordedFailure } from '@/lib/reportError';
import { runtimeSecurityApi } from './runtimeSecurityApi';

/** Re-mint when less than this is left: a policy must outlive the start it is minted for. */
export const WORKER_POLICY_RENEW_MS = 5 * 60_000;

interface CachedPolicy {
  policy: string;
  expiresAtMs: number;
  /** The origin key it is bound to: a runtime rebooted under another id opens another origin. */
  originKey: string;
}

const policies = new Map<string, CachedPolicy>();

function live(entry: CachedPolicy | undefined, now: number): entry is CachedPolicy {
  return !!entry && entry.expiresAtMs - WORKER_POLICY_RENEW_MS > now;
}

/** The policy id for `applicationId`, or undefined (the most restrictive policy). Never waits. */
export function workerPolicyFor(applicationId: string, now: number = Date.now()): string | undefined {
  const entry = policies.get(applicationId);
  return live(entry, now) ? entry.policy : undefined;
}

/**
 * Make sure `applicationId` has a live policy, minting one when it has none. `originKey` is the
 * key the runtime will open the application's origin on (`previewOriginKey(runtimeId, applicationId)`):
 * a minted policy bound to any other key is dropped. Never throws.
 */
export async function prepareWorkerPolicy(projectId: string, applicationId: string, originKey: string): Promise<void> {
  const now = Date.now();
  const cached = policies.get(applicationId);
  if (live(cached, now) && cached.originKey === originKey) return;
  policies.delete(applicationId);
  const project = Number(projectId);
  if (!Number.isSafeInteger(project) || project <= 0) return;
  try {
    const minted = await runtimeSecurityApi.mintWorkerPolicy(project, applicationId);
    const expiresAtMs = Date.parse(minted.expiresAt);
    if (minted.originKey !== originKey || !Number.isFinite(expiresAtMs)) return;
    policies.set(applicationId, { policy: minted.policy, expiresAtMs, originKey });
  } catch (error) {
    // Quiet for the person (the app runs under the most restrictive policy); recorded for us.
    recordedFailure('Minting a worker egress policy', undefined)(error);
  }
}

/** Test seam: forget every cached policy. */
export function clearWorkerPolicies(): void {
  policies.clear();
}

/**
 * Application — binding a sync request to a destination (G10/G11).
 *
 * The client NAMES a destination; this decides whether the caller may use it
 * and what its server key is:
 *
 * 1. The tenant comes from auth, never from the client. An explicit tenant or
 *    account that contradicts the token is refused; an omitted one is filled
 *    from the token (`normaliseSyncDestination`).
 * 2. A `projectId` must be the caller's tenant's project BEFORE the destination
 *    key is built: a decimal server id must exist in the tenant; a client UUID
 *    must map to a project this tenant imported. A UUID with no mapping yet is
 *    a project still on its way — a push holds the batch `dependency_pending`
 *    (retryable, nothing written) unless the batch itself creates that project.
 *    Anything else is `destination_project_invalid`.
 * 3. {@link mayBindSyncDestination} — the ONE first-bind policy.
 */

import { TenantRole, hasMinRole } from '../../domain/shared/types';
import {
  destinationKey,
  isJournalEventId,
  normaliseSyncDestination,
  type EntityDestination,
  type NormalisedDestination,
} from '../../domain/sync/syncProtocol';
import { serverNumericId } from './importers';
import type { SyncAuthContext, SyncStores } from './syncPorts';

export type SyncDestinationPurpose = 'push' | 'pull';

/**
 * WHO MAY BIND A DESTINATION (PRD open question, decided 2026-10-19): any tenant
 * member with write access to the project may bind it on first push — write
 * access is tenant role `developer` or above (viewer and contributor are
 * read-only on projects). Reading a destination (pull) needs any membership.
 * The project-in-tenant half is checked by {@link resolveSyncDestination}
 * before this runs. Tighten here — and only here — if binding moves to admins.
 */
export function mayBindSyncDestination(auth: SyncAuthContext, purpose: SyncDestinationPurpose): boolean {
  return hasMinRole(auth.role, purpose === 'push' ? TenantRole.DEVELOPER : TenantRole.VIEWER);
}

export interface BoundSyncDestination {
  ok: true;
  destination: NormalisedDestination;
  key: string;
  /** The named project is a client UUID not mapped yet — hold the push, write nothing. */
  projectPending: boolean;
}

export type ResolveSyncDestinationResult =
  | BoundSyncDestination
  | { ok: false; status: 400 | 403; code: string };

type ProjectVerdict = 'owned' | 'pending' | 'invalid';

async function projectVerdict(
  projectId: string,
  tenantId: number,
  stores: Pick<SyncStores, 'findMapping' | 'references'>,
  projectsCreatedInBatch: ReadonlySet<string>,
): Promise<ProjectVerdict> {
  const id = serverNumericId(projectId);
  if (id !== null) return (await stores.references.projectInTenant(tenantId, id)) ? 'owned' : 'invalid';
  if (!isJournalEventId(projectId)) return 'invalid';
  if (await stores.findMapping(tenantId, 'project', projectId)) return 'owned';
  return projectsCreatedInBatch.has(projectId.toLowerCase()) ? 'owned' : 'pending';
}

/**
 * Normalise, verify, and authorise one request destination. The key returned
 * is the ONLY key the request may read or write.
 */
export async function resolveSyncDestination(
  raw: EntityDestination,
  auth: SyncAuthContext,
  stores: Pick<SyncStores, 'findMapping' | 'references'>,
  options: { purpose: SyncDestinationPurpose; projectsCreatedInBatch?: ReadonlySet<string> },
): Promise<ResolveSyncDestinationResult> {
  const normalised = normaliseSyncDestination(raw, auth);
  if (!normalised.ok) return { ok: false, status: 400, code: normalised.code };
  const destination = normalised.destination;

  let projectPending = false;
  if (destination.projectId !== undefined) {
    const verdict = await projectVerdict(
      destination.projectId,
      auth.tenantId,
      stores,
      options.projectsCreatedInBatch ?? new Set(),
    );
    if (verdict === 'invalid') return { ok: false, status: 400, code: 'destination_project_invalid' };
    projectPending = verdict === 'pending' && options.purpose === 'push';
  }

  if (!mayBindSyncDestination(auth, options.purpose)) {
    return { ok: false, status: 403, code: 'destination_bind_forbidden' };
  }
  return { ok: true, destination, key: destinationKey(destination), projectPending };
}

/** The key an event's own destination normalises to, or null when it cannot be the caller's. */
export function normalisedKeyOf(destination: EntityDestination, auth: SyncAuthContext): string | null {
  const normalised = normaliseSyncDestination(destination, auth);
  return normalised.ok ? destinationKey(normalised.destination) : null;
}

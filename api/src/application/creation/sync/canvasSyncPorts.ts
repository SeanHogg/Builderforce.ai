/**
 * What the canvas sync importers need from outside the unit of work's transaction.
 *
 * Both come from the request, not the transaction: the plan check reads the tenant's plan
 * and the platform-superadmin flag (cached, on `env`), and the snapshot is written on the
 * request's own connection AFTER the chunk commits. The composition root
 * (`sync/syncStoresFor.ts`) binds them once per request.
 */

import type { Db } from '../../../infrastructure/database/connection';
import type { CreationSessionQuota } from '../../../domain/tenant/creationSessionQuota';
import type { BoardSnapshotEffect } from '../boardSnapshotWriter';

export interface CanvasSyncPorts {
  /** May the caller's workspace save one more board — the same answer `POST /claim` gets. */
  sessionQuota(db: Db, tenantId: number, userId: string): Promise<CreationSessionQuota>;
  /** The deferred, once-per-chunk snapshot write for a board an edit just moved. */
  scheduleSnapshot(tenantId: number, sessionId: string): BoardSnapshotEffect;
}

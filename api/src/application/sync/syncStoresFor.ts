/**
 * Composition — the production `SyncStores` for a request's database handle.
 *
 * Wires the ONE Drizzle adapter (`infrastructure/repositories/SyncRepository`)
 * with the importer factory (bound per transaction) and the cross-context
 * reference reader, which reuses each context's own tenant gate rather than a
 * sync-local copy: project ownership (`projectOwnership.projectInTenant`), task
 * ownership (`tenantScope.taskInTenant`), and active membership
 * (`tenantRoles.isActiveTenantMember`). The usage importer writes through the
 * usage ledger port (`syncUsageLedger`), which needs `env` for its own database.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { syncUsageLedger } from './syncUsageLedger';
import { taskInTenant } from '../../infrastructure/database/tenantScope';
import { createSyncRepository } from '../../infrastructure/repositories/SyncRepository';
import { projectInTenant } from '../project/projectOwnership';
import { isActiveTenantMember } from '../tenant/tenantRoles';
import { namedSyncImporters } from './importers/namedSyncImporters';
import type { SyncReferenceReader, SyncStores } from './syncPorts';

export function syncReferenceReader(db: Db): SyncReferenceReader {
  return {
    projectInTenant: (tenantId, projectId) => projectInTenant(db, tenantId, projectId),
    taskInTenant: (tenantId, taskId) => taskInTenant(db, taskId, tenantId),
    tenantMember: (tenantId, userId) => isActiveTenantMember(db, tenantId, userId),
  };
}

export function syncStoresFor(db: Db, env: Env): SyncStores {
  const usage = syncUsageLedger(db, env);
  return createSyncRepository(db, (tx) => namedSyncImporters(tx, usage), syncReferenceReader(db));
}

/**
 * Composition — the production `SyncStores` for a request's database handle.
 *
 * Wires the ONE Drizzle adapter (`infrastructure/repositories/SyncRepository`)
 * with the importer factory (bound per transaction) and the cross-context
 * reference reader, which reuses each context's own tenant gate rather than a
 * sync-local copy: project ownership (`projectOwnership.projectInTenant`), task
 * ownership (`tenantScope.taskInTenant`), and active membership
 * (`tenantRoles.isActiveTenantMember`), and chat ownership (`brainChatGuards.chatOwnedBy`). The usage importer writes through the
 * usage ledger port (`syncUsageLedger`), which needs `env` for its own database.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { syncUsageLedger } from './syncUsageLedger';
import { syncStepStore } from './syncStepStore';
import { taskInTenant } from '../../infrastructure/database/tenantScope';
import { createSyncRepository } from '../../infrastructure/repositories/SyncRepository';
import { chatOwnedBy } from '../brain/brainChatGuards';
import { projectInTenant } from '../project/projectOwnership';
import { isActiveTenantMember } from '../tenant/tenantRoles';
import { namedSyncImporters } from './importers/namedSyncImporters';
import type { SyncReferenceReader, SyncStores } from './syncPorts';

export function syncReferenceReader(db: Db): SyncReferenceReader {
  return {
    projectInTenant: (tenantId, projectId) => projectInTenant(db, tenantId, projectId),
    taskInTenant: (tenantId, taskId) => taskInTenant(db, taskId, tenantId),
    tenantMember: (tenantId, userId) => isActiveTenantMember(db, tenantId, userId),
    chatOwnedBy: (tenantId, userId, chatId) => chatOwnedBy(db, tenantId, userId, chatId),
  };
}

export function syncStoresFor(db: Db, env: Env): SyncStores {
  const usage = syncUsageLedger(db, env);
  const steps = syncStepStore(db);
  return createSyncRepository(db, (tx) => namedSyncImporters(tx, usage, steps), syncReferenceReader(db));
}

/**
 * The importer factory — binds the three named importers to ONE transaction.
 *
 * The push's unit of work (`SyncStores.transact`) calls this with its own
 * transaction handle, so the importer's domain write (the `tasks` / `projects`
 * row) commits or rolls back together with the mapping, projection, change row
 * and receipt. Before this seam the importers wrote through the request's outer
 * handle, and a receipt rollback left an orphaned domain row behind.
 *
 * There is no payload-writer fallback: an entity type with no owning importer
 * is rejected by the push before this is reached.
 */

import type { Tx } from '../../../infrastructure/database/connection';
import type { SyncNamedImporters } from '../syncPorts';
import { importMirrorRecord } from './importMirrorRecord';
import { importSyncedProject } from './importSyncedProject';
import { importSyncedTicket } from './importSyncedTicket';

export function namedSyncImporters(tx: Tx): SyncNamedImporters {
  return {
    importSyncedTicket: (event, ctx, stores) => importSyncedTicket(event, ctx, stores, tx),
    importSyncedProject: (event, ctx, stores) => importSyncedProject(event, ctx, stores, tx),
    importMirrorRecord,
  };
}

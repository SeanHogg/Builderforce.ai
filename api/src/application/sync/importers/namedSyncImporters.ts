/**
 * The importer factory — binds the named importers to ONE transaction.
 *
 * The push's unit of work (`SyncStores.transact`) calls this with its own
 * transaction handle, so the importer's domain write (the `tasks` / `projects` /
 * `brain_chats` / `brain_chat_messages` row) commits or rolls back together with
 * the mapping, projection, change row and receipt. Before this seam the importers
 * wrote through the request's outer handle, and a receipt rollback left an
 * orphaned domain row behind.
 *
 * The usage importer is the one exception, and it is structural: `llm_usage_log`
 * lives in another database, so it writes through the {@link SyncUsageLedger} port
 * (deduped by idempotency key), not through `tx`.
 *
 * There is no payload-writer fallback: an entity type with no owning importer
 * is rejected by the push before this is reached.
 */

import type { Tx } from '../../../infrastructure/database/connection';
import type { SyncNamedImporters, SyncUsageLedger } from '../syncPorts';
import { importMirrorRecord } from './importMirrorRecord';
import { importSyncedChat } from './importSyncedChat';
import { importSyncedMessage } from './importSyncedMessage';
import { importSyncedProject } from './importSyncedProject';
import { importSyncedTicket } from './importSyncedTicket';
import { importSyncedUsage } from './importSyncedUsage';

export function namedSyncImporters(tx: Tx, usage: SyncUsageLedger): SyncNamedImporters {
  return {
    importSyncedTicket: (event, ctx, stores) => importSyncedTicket(event, ctx, stores, tx),
    importSyncedProject: (event, ctx, stores) => importSyncedProject(event, ctx, stores, tx),
    importSyncedChat: (event, ctx, stores) => importSyncedChat(event, ctx, stores, tx),
    importSyncedMessage: (event, ctx, stores) => importSyncedMessage(event, ctx, stores, tx),
    importSyncedUsage: (event, ctx, stores) => importSyncedUsage(event, ctx, stores, usage),
    importMirrorRecord,
  };
}

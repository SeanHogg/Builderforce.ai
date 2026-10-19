/**
 * G17 — mirror importer for history-only entity types.
 *
 * Chat, message, execution, audit, change-set, memory, and the rest have no
 * owning server aggregate. This importer accepts them as client-reported
 * history and refuses ticket and project so they cannot fall through into a
 * generic payload writer. It does not insert a domain row, does not open a
 * remediation, and does not write the sync projection — the route (G15) persists
 * the returned mapping fields.
 */

import type { LocalEntityType } from '../../../domain/sync/syncProtocol';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../syncPorts';
import {
  appliedExisting,
  appliedNew,
  conflict,
  mutateGate,
  preludeRejection,
  rejected,
  type BoundedImportOutcome,
} from './index';

/** History-only types. Ticket and project are deliberately absent. */
export const MIRROR_ENTITY_TYPES = [
  'chat',
  'message',
  'execution',
  'step',
  'approval',
  'audit-definition',
  'audit-run',
  'audit-finding',
  'change-set',
  'memory-fact',
  'attachment-manifest',
  'policy-snapshot',
  'remediation',
] as const satisfies readonly LocalEntityType[];

const MIRROR_TYPE_SET: ReadonlySet<string> = new Set(MIRROR_ENTITY_TYPES);

export function mirrorRefuses(entityType: string): boolean {
  return entityType === 'ticket' || entityType === 'project' || !MIRROR_TYPE_SET.has(entityType);
}

function historyPayload(event: SyncEventInput): unknown {
  return event.operation === 'delete' ? null : event.payload;
}

/**
 * Accept one history-only mutation. Ticket and project are always rejected,
 * before any mapping read, so this path cannot update those aggregates.
 */
export async function importMirrorRecord(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
): Promise<BoundedImportOutcome> {
  if (mirrorRefuses(event.entityType)) return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  if (event.operation !== 'create' && event.operation !== 'import' && event.operation !== 'update' && event.operation !== 'delete') {
    return rejected('operation_unsupported');
  }
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  const payload = historyPayload(event);
  if (event.operation === 'create' || event.operation === 'import') {
    if (mapping) {
      if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
      if (mapping.payloadHash === hashSyncPayload(payload)) return appliedExisting(mapping, payload);
      return conflict(mapping, 'entity_already_imported');
    }
    return appliedNew(event.clientEntityId, 1, ctx.destinationKey, payload);
  }
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  if (current.payloadHash === hashSyncPayload(payload) && event.operation === 'update') {
    return appliedExisting(current, payload);
  }
  return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, payload);
}

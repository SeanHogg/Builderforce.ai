/**
 * How a board edit's result becomes the importer's outcome — written once, so a board,
 * an object and an edge answer "applied / replayed / refused / failed" the same way.
 */

import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { appliedExisting, appliedNew, rejected, type BoundedImportOutcome } from '../../sync/importers';
import type { SyncEntityMappingRow } from '../../sync/syncPorts';
import type { BoardEditResult } from '../boardEditWriter';
import { isCreationEventWriteConflict } from '../creationGraphWriter';

/**
 * - `mapping` null: a create. Applied and replayed both land the entity at version 1.
 * - `mapping` present: an update or delete. Applied bumps the version; a replayed event
 *   (its key is already on the board) changes nothing and is acknowledged as it stands.
 */
export function editOutcome(
  result: BoardEditResult,
  entity: { serverId: string; destinationKey: string; stored: unknown; mapping: SyncEntityMappingRow | null },
): BoundedImportOutcome {
  if (result.status === 'missing') return rejected('canvas_write_failed');
  if (result.status === 'refused') return rejected(result.code);
  if (entity.mapping === null) return appliedNew(entity.serverId, 1, entity.destinationKey, entity.stored);
  if (result.status === 'replayed') return appliedExisting(entity.mapping, entity.stored);
  return appliedNew(entity.mapping.serverId, entity.mapping.serverVersion + 1, entity.destinationKey, entity.stored);
}

/**
 * A write that threw. Losing the revision / idempotency race to a route writer is expected
 * and is a HOLD (retried on the next round); anything else is reported and also a hold —
 * `canvas_write_failed` is not a permanent refusal, so a transient failure never dead-letters.
 */
export function canvasWriteFailure(error: unknown, source: string, operation: string): BoundedImportOutcome {
  if (!isCreationEventWriteConflict(error)) {
    reportCaughtError(error, { source: `application/creation/sync/${source}`, operation });
  }
  return rejected('canvas_write_failed');
}

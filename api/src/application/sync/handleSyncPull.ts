/**
 * Application — serve one sync pull page (G18).
 *
 * No cursor starts a SNAPSHOT: the database `xmin` is read FIRST, then the
 * projection is keyset-paged; that `xmin` rides every snapshot cursor, so a change
 * written while the snapshot pages is still delivered by the delta that follows.
 * The last snapshot page hands over a DELTA cursor at `(xmin, 0)`.
 *
 * A delta page reads this destination's COMMITTED-AND-FINAL changes after the
 * cursor in `(txid, seq)` order (commit order — see `domain/sync/deltaWatermark`),
 * together with the database `xmin` of the same statement. A page that drains the
 * destination advances the cursor to `(xmin, 0)` — an idle destination moves with
 * the database instead of sitting still — never to a per-tenant tip, and a full
 * page advances to its last row. A legacy (seq only) cursor is translated once.
 *
 * A cursor this codec did not mint, or a delta whose following rows may have
 * been swept (`deltaCursorExpired`), is `{ records: [], resnapshotRequired:
 * true }` — never a partial page. Pull never writes.
 */

import {
  decodeSyncCursor,
  deltaCursorExpired,
  encodeSyncCursor,
  type DeltaCursor,
  type LegacyDeltaCursor,
} from '../../domain/sync/cursorCodec';
import { WATERMARK_ORIGIN, nextDeltaCursor, type SyncWatermark } from '../../domain/sync/deltaWatermark';
import { SYNC_CHANGE_RETENTION_DAYS } from '../../domain/sync/syncRetention';
import type { SyncPullResult } from '../../domain/sync/syncProtocol';
import { readPullRequest } from './syncEnvelope';
import { resolveSyncDestination, type BoundSyncDestination } from './syncDestination';
import { copyRecord, rowToRecord } from './syncPersist';
import type { SyncAuthContext, SyncStores } from './syncPorts';

export interface SyncPullDeps {
  auth: SyncAuthContext;
  now: Date;
  stores: SyncStores;
}

export type SyncPullResponse =
  | { ok: false; status: 400 | 403; code: string }
  | { ok: true; status: 200; result: SyncPullResult };

function page(result: SyncPullResult): SyncPullResponse {
  return { ok: true, status: 200, result };
}

const resnapshot = (): SyncPullResponse => page({ records: [], resnapshotRequired: true });

async function snapshotPage(
  deps: SyncPullDeps,
  bound: BoundSyncDestination,
  after: { entityType: string; clientEntityId: string } | null,
  tipTxid: string,
  issuedAt: number,
  limit: number,
): Promise<SyncPullResponse> {
  const rows = await deps.stores.snapshotAfter(deps.auth.tenantId, bound.key, after, limit);
  const records = rows.map((row) => rowToRecord(row, bound.destination));
  const last = rows[rows.length - 1];
  if (rows.length === limit && last) {
    return page({
      records,
      cursor: encodeSyncCursor({
        v: 2,
        kind: 'snapshot',
        afterEntityType: last.entityType,
        afterClientEntityId: last.clientEntityId,
        tipTxid,
        issuedAt,
      }),
    });
  }
  // The delta resumes at (xmin, 0): everything below that xmin was final when the snapshot began.
  return page({ records, cursor: encodeSyncCursor({ v: 2, kind: 'delta', txid: tipTxid, seq: 0, issuedAt }) });
}

/**
 * The cursor's watermark. A v2 cursor carries it. A legacy (seq only) cursor S is ALWAYS
 * translated to `('0', S)`: rows written during the migration window by the previous Worker
 * carry real txids that need not follow their seq order, so anchoring S on the txid of S's own
 * row would sort those rows below the cursor and skip them. `('0', S)` re-delivers every row
 * with a real txid (a plain re-put on the client — idempotent) and loses none; rows at txid 0
 * resume strictly after S. Expiry is still checked against this position.
 */
function cursorPosition(cursor: DeltaCursor | LegacyDeltaCursor): SyncWatermark {
  if (cursor.v === 2) return { txid: cursor.txid, seq: cursor.seq };
  return cursor.seq === 0 ? WATERMARK_ORIGIN : { txid: '0', seq: cursor.seq };
}

async function deltaPage(
  deps: SyncPullDeps,
  bound: BoundSyncDestination,
  cursor: DeltaCursor | LegacyDeltaCursor,
  limit: number,
): Promise<SyncPullResponse> {
  const tenantId = deps.auth.tenantId;
  const position = cursorPosition(cursor);
  const destinationMin = await deps.stores.minChangeWatermark(tenantId, bound.key);
  // A legacy cursor is a bare seq: a retained row at or before that seq proves the later ones survived
  // (the watermark order of a migration-window row need not follow its seq).
  const expiryPosition = cursor.v === 1 && destinationMin && destinationMin.seq <= cursor.seq ? destinationMin : position;
  if (deltaCursorExpired(cursor, expiryPosition, { now: deps.now, retentionDays: SYNC_CHANGE_RETENTION_DAYS, destinationMin })) {
    return resnapshot();
  }
  const { rows, xmin } = await deps.stores.changesAfter(tenantId, bound.key, position, limit);
  const next = nextDeltaCursor({ rows, limit, prior: position, xmin });
  return page({
    records: rows.map((change) => copyRecord(change.record)),
    cursor: encodeSyncCursor({ v: 2, kind: 'delta', txid: next.txid, seq: next.seq, issuedAt: deps.now.getTime() }),
  });
}

/** Serve one pull page. See the module comment for the cursor rules. */
export async function handleSyncPull(body: unknown, deps: SyncPullDeps): Promise<SyncPullResponse> {
  const read = readPullRequest(body);
  if (!read.ok) return { ok: false, status: 400, code: read.code };
  const { request } = read;

  const bound = await resolveSyncDestination(request.destination, deps.auth, deps.stores, { purpose: 'pull' });
  if (!bound.ok) return { ok: false, status: bound.status, code: bound.code };

  if (request.cursorMalformed) return resnapshot();
  if (request.cursor === null) {
    const tipTxid = await deps.stores.databaseXmin();
    return snapshotPage(deps, bound, null, tipTxid, deps.now.getTime(), request.limit);
  }
  const decoded = decodeSyncCursor(request.cursor);
  if (!decoded) return resnapshot();
  if (decoded.kind === 'snapshot') {
    return snapshotPage(
      deps,
      bound,
      { entityType: decoded.afterEntityType, clientEntityId: decoded.afterClientEntityId },
      decoded.tipTxid,
      decoded.issuedAt,
      request.limit,
    );
  }
  return deltaPage(deps, bound, decoded, request.limit);
}

/**
 * Application — serve one sync pull page (G18).
 *
 * No cursor starts a SNAPSHOT: the tenant tip is read FIRST, then the
 * projection is keyset-paged; the tip rides every snapshot cursor, so a change
 * written while the snapshot pages is still delivered by the delta that follows.
 * The last snapshot page hands over a DELTA cursor at that tip.
 *
 * A delta page reads the tip, then this destination's changes after the
 * cursor. A page that drains the destination advances the cursor to the tip —
 * a destination with no changes of its own moves with the log instead of
 * sitting at 0 — and a full page advances to its last row.
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
} from '../../domain/sync/cursorCodec';
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
  tip: number,
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
        v: 1,
        kind: 'snapshot',
        afterEntityType: last.entityType,
        afterClientEntityId: last.clientEntityId,
        tip,
        issuedAt,
      }),
    });
  }
  return page({ records, cursor: encodeSyncCursor({ v: 1, kind: 'delta', seq: tip, issuedAt }) });
}

async function deltaPage(
  deps: SyncPullDeps,
  bound: BoundSyncDestination,
  cursor: DeltaCursor,
  limit: number,
): Promise<SyncPullResponse> {
  const tenantId = deps.auth.tenantId;
  const destinationMinSeq = await deps.stores.minChangeSeq(tenantId, bound.key);
  if (deltaCursorExpired(cursor, { now: deps.now, retentionDays: SYNC_CHANGE_RETENTION_DAYS, destinationMinSeq })) {
    return resnapshot();
  }
  const tip = await deps.stores.maxChangeSeq(tenantId);
  const changes = await deps.stores.changesAfter(tenantId, bound.key, cursor.seq, limit);
  const last = changes[changes.length - 1];
  const seq = changes.length === limit && last
    ? last.seq
    : Math.max(cursor.seq, tip, last ? last.seq : 0);
  return page({
    records: changes.map((change) => copyRecord(change.record)),
    cursor: encodeSyncCursor({ v: 1, kind: 'delta', seq, issuedAt: deps.now.getTime() }),
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
    const tip = await deps.stores.maxChangeSeq(deps.auth.tenantId);
    return snapshotPage(deps, bound, null, tip, deps.now.getTime(), request.limit);
  }
  const decoded = decodeSyncCursor(request.cursor);
  if (!decoded) return resnapshot();
  if (decoded.kind === 'snapshot') {
    return snapshotPage(
      deps,
      bound,
      { entityType: decoded.afterEntityType, clientEntityId: decoded.afterClientEntityId },
      decoded.tip,
      decoded.issuedAt,
      request.limit,
    );
  }
  return deltaPage(deps, bound, decoded, request.limit);
}

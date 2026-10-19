/**
 * Application — idempotent sync apply (G16, ticket #5850).
 *
 * A client event is applied at most once per (tenant, device, event). The
 * mutation and the receipt commit in ONE transaction: a throw after the
 * projection is staged — including a thrown change-log append — leaves
 * neither the projection nor the receipt.
 *
 * `dependency_pending` is a protocol status, not a terminal receipt. An event
 * whose `dependsOn` id is not already accepted is returned pending and is not
 * written, so the same event can be applied once the dependency lands. This
 * module does not park, import, or route: the mutation in this slice is
 * `store.put` of the sync projection row plus the receipt.
 *
 * In-memory only. No database, no HTTP, no domain importer.
 */

/** Stored receipts are accepts. `dependency_pending` is never one of them. */
export type StoredReceiptStatus = 'accepted';

export type SyncApplyStatus = StoredReceiptStatus | 'duplicate' | 'dependency_pending';

export interface SyncApplyEvent {
  tenantId: number;
  deviceId: string;
  eventId: string;
  clientEntityId: string;
  entityType: string;
  payload: unknown;
  /** Event ids that must already be accepted in this tenant. Omitted, null, or empty means none. */
  dependsOn?: readonly string[] | null;
}

/** The receipt row. Status is always `accepted` — a replay returns a copy marked `duplicate`. */
export interface SyncApplyReceipt {
  tenantId: number;
  deviceId: string;
  eventId: string;
  status: StoredReceiptStatus;
  serverId: string;
  clientEntityId: string;
  entityType: string;
}

/** The sync projection row `put` writes beside the receipt. */
export interface SyncProjectionRow {
  tenantId: number;
  deviceId: string;
  eventId: string;
  clientEntityId: string;
  entityType: string;
  serverId: string;
  payload: unknown;
}

/** One delta-log append. A throw from this step rolls the transaction back. */
export interface SyncChangeAppend {
  tenantId: number;
  deviceId: string;
  eventId: string;
  clientEntityId: string;
  entityType: string;
  serverId: string;
}

export interface SyncApplyResult {
  status: SyncApplyStatus;
  serverId: string | null;
  /**
   * The first receipt. On a replay, the same row with `status: 'duplicate'`.
   * Null when the event is `dependency_pending` — nothing was stored.
   */
  receipt: (Omit<SyncApplyReceipt, 'status'> & { status: 'accepted' | 'duplicate' }) | null;
  /** The first unmet dependency id, when status is `dependency_pending`. */
  unmet?: string;
}

/** The unit of work `applySyncEvent` writes inside. Reads see this transaction's draft. */
export interface IdempotentApplyTx {
  findReceipt(tenantId: number, deviceId: string, eventId: string): SyncApplyReceipt | null;
  /** True when `eventId` was accepted in this tenant (any device). */
  isAccepted(tenantId: number, eventId: string): boolean;
  /** Stage the projection and the receipt together. Not visible until the transaction commits. */
  put(projection: SyncProjectionRow, receipt: SyncApplyReceipt): void;
  /** Append the change-log row. May throw; the store must then drop the staged put. */
  append(change: SyncChangeAppend): void;
}

export interface IdempotentApplyStore {
  transaction<T>(work: (tx: IdempotentApplyTx) => T): T;
}

interface MemoryState {
  receipts: Map<string, SyncApplyReceipt>;
  projections: Map<string, SyncProjectionRow>;
  changes: SyncChangeAppend[];
  accepted: Set<string>;
}

function receiptKey(tenantId: number, deviceId: string, eventId: string): string {
  return `${tenantId}\0${deviceId}\0${eventId}`;
}

function projectionKey(tenantId: number, entityType: string, clientEntityId: string): string {
  return `${tenantId}\0${entityType}\0${clientEntityId}`;
}

function acceptedKey(tenantId: number, eventId: string): string {
  return `${tenantId}\0${eventId}`;
}

function emptyState(): MemoryState {
  return {
    receipts: new Map(),
    projections: new Map(),
    changes: [],
    accepted: new Set(),
  };
}

function cloneState(state: MemoryState): MemoryState {
  return {
    receipts: new Map(state.receipts),
    projections: new Map(state.projections),
    changes: state.changes.slice(),
    accepted: new Set(state.accepted),
  };
}

function dependencyIds(event: SyncApplyEvent): string[] {
  const declared = event.dependsOn;
  if (declared == null) return [];
  const ids: string[] = [];
  for (const candidate of declared) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed !== '') ids.push(trimmed);
  }
  return ids;
}

function newServerId(): string {
  return crypto.randomUUID();
}

/**
 * Apply `event` at most once.
 *
 * - Same `(tenantId, deviceId, eventId)`: the first receipt, status `duplicate`.
 *   No second projection, receipt, or change-log row.
 * - An unmet `dependsOn` id: `{ status: 'dependency_pending' }` and no write.
 *   That status is not stored, so the event stays retryable.
 * - Otherwise the projection and the receipt are put, then the change is
 *   appended, all inside `store.transaction`. A throw from `append` (or from
 *   anything after `put`) must leave neither row.
 */
export function applySyncEvent(store: IdempotentApplyStore, event: SyncApplyEvent): SyncApplyResult {
  return store.transaction((tx) => {
    const existing = tx.findReceipt(event.tenantId, event.deviceId, event.eventId);
    if (existing) {
      return {
        status: 'duplicate',
        serverId: existing.serverId,
        receipt: { ...existing, status: 'duplicate' },
      };
    }

    const unmet = dependencyIds(event).find((id) => !tx.isAccepted(event.tenantId, id));
    if (unmet !== undefined) {
      return { status: 'dependency_pending', serverId: null, receipt: null, unmet };
    }

    const serverId = newServerId();
    const receipt: SyncApplyReceipt = {
      tenantId: event.tenantId,
      deviceId: event.deviceId,
      eventId: event.eventId,
      status: 'accepted',
      serverId,
      clientEntityId: event.clientEntityId,
      entityType: event.entityType,
    };
    const projection: SyncProjectionRow = {
      tenantId: event.tenantId,
      deviceId: event.deviceId,
      eventId: event.eventId,
      clientEntityId: event.clientEntityId,
      entityType: event.entityType,
      serverId,
      payload: event.payload,
    };
    tx.put(projection, receipt);
    tx.append({
      tenantId: event.tenantId,
      deviceId: event.deviceId,
      eventId: event.eventId,
      clientEntityId: event.clientEntityId,
      entityType: event.entityType,
      serverId,
    });
    return { status: 'accepted', serverId, receipt };
  });
}

export interface MemorySyncApplyStore extends IdempotentApplyStore {
  receipts(): SyncApplyReceipt[];
  projections(): SyncProjectionRow[];
  changes(): SyncChangeAppend[];
  /** Committed puts only. A rolled-back append does not increment this. */
  committedMutations(): number;
  /** The next `append` throws `error` after `put` has been staged, then clears. */
  failNextAppend(error?: Error): void;
}

/**
 * In-memory repository whose `transaction` commits the draft only if `work`
 * returns. A throw restores the snapshot taken at the start, so a failed
 * append cannot leave the projection or the receipt behind.
 */
export function createMemorySyncApplyStore(): MemorySyncApplyStore {
  let state = emptyState();
  let committedMutations = 0;
  let pendingFailure: Error | null = null;

  return {
    receipts: () => [...state.receipts.values()],
    projections: () => [...state.projections.values()],
    changes: () => state.changes.slice(),
    committedMutations: () => committedMutations,
    failNextAppend(error?: Error) {
      pendingFailure = error ?? new Error('append failed');
    },
    transaction<T>(work: (tx: IdempotentApplyTx) => T): T {
      const snapshot = state;
      const draft = cloneState(state);
      let wrote = false;
      const tx: IdempotentApplyTx = {
        findReceipt(tenantId, deviceId, eventId) {
          return draft.receipts.get(receiptKey(tenantId, deviceId, eventId)) ?? null;
        },
        isAccepted(tenantId, eventId) {
          return draft.accepted.has(acceptedKey(tenantId, eventId));
        },
        put(projection, receipt) {
          if (receipt.status !== 'accepted') {
            throw new Error('dependency_pending is not a terminal receipt');
          }
          draft.projections.set(
            projectionKey(projection.tenantId, projection.entityType, projection.clientEntityId),
            projection,
          );
          draft.receipts.set(receiptKey(receipt.tenantId, receipt.deviceId, receipt.eventId), receipt);
          draft.accepted.add(acceptedKey(receipt.tenantId, receipt.eventId));
          wrote = true;
        },
        append(change) {
          const failure = pendingFailure;
          if (failure) {
            pendingFailure = null;
            throw failure;
          }
          draft.changes.push(change);
        },
      };
      try {
        const result = work(tx);
        state = draft;
        if (wrote) committedMutations += 1;
        return result;
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };
}

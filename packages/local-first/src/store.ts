/**
 * The in-memory local-first store and the public store surface.
 *
 * The contract lives in `storeContract.ts`, the committed state in `storeState.ts`, the
 * copy-on-write transaction in `storeTransaction.ts`, and what a commit changed in
 * `localFirstDelta.ts`; this module composes them and re-exports the lot, so
 * `import … from './store.js'` stays the one path.
 *
 * A commit costs O(rows it changed): the transaction writes a draft overlay, the store
 * hands the resulting delta to the host's `onCommit` (the journal append), and only once
 * that resolves is the delta applied to the long-lived committed state. A host that
 * learns of another window's commit calls `applyDelta` instead of rebuilding.
 */

import {
  UNBOUND_DESTINATION,
  type EntityDestination,
  type JournalEvent,
  type LocalEntityType,
  type LocalRecord,
} from './records.js';
import { isEmptyDelta, type LocalFirstChange, type LocalFirstDelta } from './localFirstDelta.js';
import { CommittedState } from './storeState.js';
import { Transaction } from './storeTransaction.js';
import type {
  LocalFirstListener,
  LocalFirstSnapshot,
  LocalFirstStore,
  LocalFirstTransaction,
} from './storeContract.js';

export * from './storeContract.js';
export { changeTouches, isEmptyDelta, resetDeltaOf, type LocalFirstChange, type LocalFirstDelta } from './localFirstDelta.js';

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Rows of `type` for which `where` holds, cloned — and ONLY those. `list` clones every
 * row of the type before the caller filters; this scans without cloning and clones the
 * matches, so reading one chat out of a whole history costs that chat.
 */
export async function selectRecords<T = unknown>(
  tx: LocalFirstTransaction,
  type: LocalEntityType | undefined,
  where?: (row: Readonly<LocalRecord<T>>) => boolean,
): Promise<LocalRecord<T>[]> {
  const matches: LocalRecord<T>[] = [];
  await tx.scan<T>(type, (row) => {
    if (!where || where(row)) matches.push(row as LocalRecord<T>);
  });
  return clone(matches);
}

/** Pending events for which `where` holds, in sequence order, cloned — only the matches. */
export async function selectPending(
  tx: LocalFirstTransaction,
  where?: (event: Readonly<JournalEvent>) => boolean,
  destination?: EntityDestination,
): Promise<JournalEvent[]> {
  const matches: JournalEvent[] = [];
  await tx.scanPending((event) => {
    if (!where || where(event)) matches.push(event as JournalEvent);
  }, destination);
  matches.sort((a, b) => a.localSequence - b.localSequence);
  return clone(matches);
}

export interface MemoryLocalFirstStoreOptions {
  /**
   * Called with the commit's delta BEFORE it is published. A host appends it to its
   * journal here; if it throws, nothing is published and the transaction fails, so a read
   * can never observe a commit no restart would see. Not called for a transaction that
   * wrote nothing. The delta's rows are the store's own — read them, never mutate them.
   */
  onCommit?: (delta: LocalFirstDelta) => Promise<void>;
}

export interface MemoryLocalFirstStore extends LocalFirstStore {
  /**
   * Apply a commit made elsewhere (another window's journal frame, or a full reload as a
   * `reset` delta). Listeners are told the change, or `undefined` for a reset. Throws if a
   * transaction is in flight: the host applies foreign commits only between its own.
   */
  applyDelta(delta: LocalFirstDelta): void;
  /**
   * The committed state as arrays WITHOUT cloning the rows: read-only, valid until the next
   * commit. A compaction streams it to disk; `export()` is the cloning, caller-owned form.
   */
  view(): LocalFirstSnapshot;
}

export function createMemoryLocalFirstStore(
  initial?: Partial<LocalFirstSnapshot>,
  options: MemoryLocalFirstStoreOptions = {},
): MemoryLocalFirstStore {
  const state = CommittedState.from(initial);
  let tail: Promise<unknown> = Promise.resolve();
  let transacting = false;
  const listeners = new Set<LocalFirstListener>();
  const notify = (change: LocalFirstChange | undefined): void => {
    for (const listener of [...listeners]) listener(change);
  };
  return {
    // Reads see the committed Maps directly: a transaction is an overlay, so there is no
    // per-read index to build and no whole-store clone — only the rows a caller asks for
    // are cloned.
    read: (work) => work(new Transaction(state, false)),
    transact(work) {
      const run = tail.then(async () => {
        const draft = new Transaction(state, true);
        transacting = true;
        try {
          const result = await work(draft);
          const delta = draft.delta();
          if (!isEmptyDelta(delta)) await options.onCommit?.(delta);
          const change = state.applyDelta(delta);
          transacting = false;
          notify(change);
          return result;
        } finally {
          transacting = false;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
    applyDelta(delta) {
      if (transacting) throw new Error('local_first_apply_during_transaction');
      notify(state.applyDelta(delta));
    },
    view: () => state.view(),
    export: async () => clone(state.view()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function newLocalRecord<T>(input: {
  id: string;
  entityType: LocalEntityType;
  payload: T;
  deviceId: string;
  destination?: EntityDestination;
  occurredAt?: string;
  schemaVersion?: number;
}): LocalRecord<T> {
  const at = input.occurredAt ?? new Date().toISOString();
  return {
    id: input.id,
    entityType: input.entityType,
    schemaVersion: input.schemaVersion ?? 1,
    version: 1,
    destination: input.destination ?? UNBOUND_DESTINATION,
    occurredAt: at,
    updatedAt: at,
    payload: input.payload,
    provenance: { deviceId: input.deviceId, source: 'local' },
  };
}

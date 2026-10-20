/**
 * G14: the domain record and its sync enqueue are one commit.
 *
 * The VSIX snapshot (`clients/vscode/src/localFirstStore.ts`) and the outbox
 * file (`packages/write-outbox`) stay separate stores. This module does not
 * import either of them and does not open their files. Callers pass both in.
 *
 * `store.write` produces the domain record. `enqueue.enqueue` produces the
 * sync row for that record. Neither side is published until both have
 * succeeded. `store.commit` is the one commit: it receives both sides in one
 * argument, and it is the only publish. There is no second write in this
 * module, so a kill before `commit` is entered cannot leave a record without
 * its sync row, or a sync row without its record — eager mutations are
 * restored first, and the values exist only in locals.
 *
 * A throw from `write` never calls `enqueue`. A throw from `enqueue` restores
 * the record snapshot taken before `write` and rolls the record store back.
 * A throw from `commit` restores both snapshots.
 *
 * `commit` must apply both sides before it resolves. Applying one side and
 * yielding is a broken host, not a second commit path this module offers.
 */

export interface CommitPair<TRecord, TSync> {
  readonly record: TRecord;
  readonly sync: TSync;
}

export interface DomainRecordStore<TRecord, TSync> {
  /** Visible records. Staging must not outlive `restore`. */
  read(): readonly TRecord[];
  /**
   * Domain write. Return the record to commit. Prefer not to publish it:
   * any mutation of `read()` is restored before enqueue runs.
   * Throw to refuse the write. Enqueue is not called.
   */
  write(): TRecord | Promise<TRecord>;
  /**
   * Make `read()` return `records`. Called to hide an eager write and to
   * undo a failed commit. After this returns, `read()` is `records`.
   */
  restore(records: readonly TRecord[]): void;
  /** Drop staging from `write`. Called only when the commit did not happen. */
  rollback(): void | Promise<void>;
  /**
   * Publish `pair.record` and `pair.sync` together. One commit.
   * The host applies the record half to the snapshot store and the sync half
   * to the outbox. Those files stay separate; this call is the only publish.
   * Throw if neither side was published. A partial publish must throw too —
   * the coordinator restores both snapshots.
   */
  commit(pair: CommitPair<TRecord, TSync>): void | Promise<void>;
}

export interface SyncEnqueueStore<TRecord, TSync> {
  /** Visible sync rows. Staging must not outlive `restore`. */
  read(): readonly TSync[];
  /**
   * Sync enqueue for `record`. Return the row. Do not publish it.
   * Throw to refuse. The record write is rolled back.
   * Not called if the record write threw.
   */
  enqueue(record: TRecord): TSync | Promise<TSync>;
  /** Make `read()` return `rows`. */
  restore(rows: readonly TSync[]): void;
  /** Drop staging from `enqueue`. Called only when the commit did not happen. */
  rollback(): void | Promise<void>;
}

function snapshot<T>(rows: readonly T[] | null | undefined): T[] {
  return Array.isArray(rows) ? rows.slice() : [];
}

async function unwind<TRecord, TSync>(
  store: DomainRecordStore<TRecord, TSync>,
  enqueue: SyncEnqueueStore<TRecord, TSync>,
  recordsBefore: readonly TRecord[],
  syncBefore: readonly TSync[],
  error: unknown,
): Promise<never> {
  try {
    store.restore(recordsBefore);
  } catch {
    // The original failure is the one the caller must see.
  }
  try {
    enqueue.restore(syncBefore);
  } catch {
    // Same: do not hide the write or enqueue error behind a restore error.
  }
  try {
    await store.rollback();
  } catch {
    // Rollback is best-effort once restore has put the snapshot back.
  }
  try {
    await enqueue.rollback();
  } catch {
    // The enqueue store may not have staged anything.
  }
  throw error;
}

/**
 * Apply the domain record write and the sync enqueue as one commit.
 * If either step throws, neither side is visible.
 */
export async function commitRecordAndEnqueue<TRecord, TSync>(
  store: DomainRecordStore<TRecord, TSync>,
  enqueue: SyncEnqueueStore<TRecord, TSync>,
): Promise<CommitPair<TRecord, TSync>> {
  const recordsBefore = snapshot(store.read());
  const syncBefore = snapshot(enqueue.read());

  let record: TRecord;
  try {
    record = await store.write();
  } catch (error) {
    return unwind(store, enqueue, recordsBefore, syncBefore, error);
  }

  // Hide an eager record write before enqueue runs, so a throw from enqueue
  // cannot observe a published record. The value is held in `record`.
  store.restore(recordsBefore);

  let sync: TSync;
  try {
    sync = await enqueue.enqueue(record);
  } catch (error) {
    return unwind(store, enqueue, recordsBefore, syncBefore, error);
  }

  // Hide an eager enqueue the same way. Both values are in hand; neither
  // store shows them. The next call is the only publish.
  enqueue.restore(syncBefore);

  const pair: CommitPair<TRecord, TSync> = { record, sync };
  try {
    await store.commit(pair);
  } catch (error) {
    return unwind(store, enqueue, recordsBefore, syncBefore, error);
  }
  return pair;
}

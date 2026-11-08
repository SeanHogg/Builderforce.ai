/**
 * Application — the transaction plumbing of a sync push (G16).
 *
 * A push is applied in CHUNKS of at most {@link PUSH_CHUNK_EVENTS} events, in dependency order.
 * Each chunk is ONE transaction (each event a savepoint inside it), opened LAZILY: only when an
 * event actually reaches the apply step, so a replay-only or refusal-only chunk opens none. A
 * chunk bounds how long locks and the database `xmin` are held (a push of hundreds of events must
 * not pin them for its whole duration) and what a deadlock retry has to redo.
 *
 * A chunk that fails with a deadlock or serialization failure is retried, whole, up to
 * {@link CHUNK_CONFLICT_RETRIES} more times with a small jittered backoff.
 */

import { chainText, pgErrorOf } from '../../infrastructure/database/uniqueViolation';
import type { SyncBatchUnit, SyncStores } from './syncPorts';

/** Events per transaction. Bounds lock/xmin hold time and redo cost; chunks keep the dependency order. */
export const PUSH_CHUNK_EVENTS = 25;

/** Retries after the first attempt of a chunk that hit a deadlock / serialization failure. */
export const CHUNK_CONFLICT_RETRIES = 2;

/** What the apply step needs of a chunk's transaction. */
export type SyncChunkUnit = Pick<SyncBatchUnit, 'savepoint' | 'references'>;

export interface LazyChunk extends SyncChunkUnit {
  /**
   * End the chunk: commit when `error` is undefined, otherwise roll back. A chunk that never opened
   * is a no-op. A commit failure is thrown; after a rollback the thrown error is `error`.
   */
  settle(error?: unknown): Promise<void>;
}

/** A chunk whose transaction opens on first use and stays open until {@link LazyChunk.settle}. */
export function lazyChunk(stores: SyncStores): LazyChunk {
  let ready: Promise<SyncBatchUnit> | undefined;
  let finish: { commit(): void; fail(error: unknown): void } | undefined;
  let done: Promise<unknown> | undefined;

  const open = (): Promise<SyncBatchUnit> => {
    ready ??= new Promise<SyncBatchUnit>((resolve, reject) => {
      done = stores.transact(async (unit) => {
        await new Promise<void>((commit, fail) => {
          finish = { commit, fail };
          resolve(unit);
        });
      });
      // A failure to OPEN reaches the first caller; a later one is thrown by `settle`.
      done.catch(reject);
    });
    return ready;
  };

  const through = <K extends keyof SyncBatchUnit['references']>(method: K) =>
    (async (...args: unknown[]) => {
      const unit = await open();
      return (unit.references[method] as (...a: unknown[]) => unknown)(...args);
    }) as SyncBatchUnit['references'][K];

  return {
    references: {
      projectInTenant: through('projectInTenant'),
      taskInTenant: through('taskInTenant'),
      tenantMember: through('tenantMember'),
      chatOwnedBy: through('chatOwnedBy'),
    },
    async savepoint(work) {
      return (await open()).savepoint(work);
    },
    async settle(error) {
      if (!finish || !done) return;
      if (error === undefined) finish.commit();
      else finish.fail(error);
      await done;
    },
  };
}

/** A deadlock (40P01) or serialization failure (40001): the transaction was a victim, not wrong. */
export function isTransactionConflict(error: unknown): boolean {
  // The SQLSTATE may sit on a `.cause` (drizzle wraps driver errors), so the shared walker finds it.
  const pg = pgErrorOf(error);
  if (pg?.code === '40P01' || pg?.code === '40001') return true;
  return /deadlock detected|could not serialize access/i.test(chainText(error));
}

/** Small jittered pause before retry `attempt` (1-based). */
export function conflictBackoff(attempt: number): Promise<void> {
  const ms = 10 * attempt + Math.random() * 20;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * What ONE commit changed — the unit a host appends to its journal and another
 * window applies to its copy, in place of a whole-store snapshot.
 *
 * A snapshot frame costs O(store) per commit (73 MB for a heavy chat history, tens of
 * seconds of blocked host thread). A delta costs O(rows the commit changed), and the
 * same delta is also what a listener is told about (`LocalFirstChange`), so a
 * subscriber decides whether it cares without reading the store.
 *
 * Applying a delta: deletions first, then upserts, in the order written. A key that is
 * both deleted and upserted was removed and re-added in one commit, so it moves to the
 * end of the store's iteration order — exactly what the committing store did.
 */

import type { LocalFirstSnapshot } from './storeContract.js';
import type {
  JournalEvent,
  LocalEntityType,
  LocalRecord,
  ServerMapping,
  SyncConflict,
  SyncReceipt,
} from './records.js';

export interface LocalFirstDelta {
  /**
   * Discard everything first. The first frame of a compacted journal carries it, which
   * makes that frame a BASE: a reader may start there and ignore every earlier frame.
   * `encodeDeltaFrame` writes it as the first JSON key so a scan can find the last base
   * from the frame bytes without parsing the frame.
   */
  reset?: true;
  /** Marks the final frame of a compacted base chain (see `journalCompaction.ts`). */
  endsBase?: true;
  /**
   * The base GENERATION this frame opens: an opaque id a host mints per compaction and
   * writes into the first frame of the new base. File identity `(ino, birthtimeMs)` is
   * weak on NTFS (inode numbers are reused), so a reader that tracks the generation id
   * knows a replaced journal from its first frame, not from a stat. Only the first frame
   * of a base carries it; pre-migration journals have none, and hosts fall back to the
   * stat identity for those.
   */
  generation?: string;
  /** Records written (created or overwritten). */
  records?: LocalRecord[];
  /** Records removed. */
  deletedRecords?: Array<{ entityType: LocalEntityType; id: string }>;
  /** Journal events appended. */
  events?: JournalEvent[];
  /** Journal events acknowledged (removed from the pending queue). */
  acknowledgedEvents?: string[];
  mappings?: ServerMapping[];
  receipts?: SyncReceipt[];
  conflicts?: SyncConflict[];
  /** Cursors set, by destination key. */
  cursors?: Record<string, string>;
  /** Cursors cleared, by destination key. */
  unsetCursors?: string[];
  nextSequence?: number;
}

/**
 * What a listener is told. Entity types and row ids are named so "did this commit touch
 * chat 12's messages" is a set lookup, never a store read.
 */
export interface LocalFirstChange {
  /** Rows written or deleted, by entity type, as ids. */
  readonly records: ReadonlyMap<LocalEntityType, ReadonlySet<string>>;
  /** The pending journal queue changed (an event was appended or acknowledged). */
  readonly events: boolean;
  /** A mapping, receipt, conflict or cursor changed. */
  readonly syncState: boolean;
}

/** True when applying the delta would change nothing. */
export function isEmptyDelta(delta: LocalFirstDelta): boolean {
  return !delta.reset
    && !delta.records?.length
    && !delta.deletedRecords?.length
    && !delta.events?.length
    && !delta.acknowledgedEvents?.length
    && !delta.mappings?.length
    && !delta.receipts?.length
    && !delta.conflicts?.length
    && !(delta.cursors && Object.keys(delta.cursors).length > 0)
    && !delta.unsetCursors?.length
    && delta.nextSequence === undefined;
}

/** Accumulates the rows a commit touched into a `LocalFirstChange`. */
export class ChangeBuilder {
  private readonly records = new Map<LocalEntityType, Set<string>>();
  private events = false;
  private syncState = false;

  record(entityType: LocalEntityType, id: string): void {
    let ids = this.records.get(entityType);
    if (!ids) this.records.set(entityType, (ids = new Set()));
    ids.add(id);
  }

  event(): void {
    this.events = true;
  }

  sync(): void {
    this.syncState = true;
  }

  build(): LocalFirstChange {
    return { records: this.records, events: this.events, syncState: this.syncState };
  }
}

/** Does this change touch rows of `entityType` (any id, or one of `ids` when given)? */
export function changeTouches(
  change: LocalFirstChange | undefined,
  entityType: LocalEntityType,
  ids?: ReadonlySet<string> | readonly string[],
): boolean {
  if (!change) return true;
  const touched = change.records.get(entityType);
  if (!touched || touched.size === 0) return false;
  if (!ids) return true;
  for (const id of ids) if (touched.has(id)) return true;
  return false;
}

/** A whole snapshot as one `reset` delta — what a host applies to adopt a freshly loaded store. */
export function resetDeltaOf(snapshot: LocalFirstSnapshot): LocalFirstDelta {
  return {
    reset: true,
    records: snapshot.records,
    events: snapshot.events,
    mappings: snapshot.mappings,
    receipts: snapshot.receipts,
    conflicts: snapshot.conflicts,
    cursors: snapshot.cursors,
    nextSequence: snapshot.nextSequence,
  };
}

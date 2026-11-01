/**
 * G03: the durable local-first journal — one APPEND per committed transaction.
 *
 * The VSIX host used to keep every record in one JSON file, rewritten whole on each
 * transaction, and then a journal whose every frame was a WHOLE snapshot: a 73 MB store
 * paid 73 MB of encode + checksum + fsync per commit. A commit now appends one frame of
 * the ROWS IT CHANGED (`BFJF2`, a `LocalFirstDelta`); the commit boundary is unchanged —
 * the transaction already commits records AND their journal events together
 * (`atomicWrite.ts` `commitWriteAndEnqueue`), so one frame carries both sides or neither,
 * and a kill during the append leaves a torn trailing frame that a restart drops.
 *
 * The pieces, by responsibility:
 *   - `journalCodec.ts`      frame bytes: header, crc32, `BFJF1` snapshot and `BFJF2` delta
 *   - `journalReplay.ts`     fold frames back into state: `scanJournal`, `scanJournalAsync`,
 *                            `decodeJournalFrames`, `readJournalTail`
 *   - `journalCompaction.ts` the shared policy and the chunked compaction writer
 *   - `localFirstDelta.ts`   what a commit changed
 *
 * `BFJF1` (one whole snapshot — the shipped format) stays readable forever; a snapshot
 * frame is simply a base. I/O is the host's: this package opens no file and imports no
 * network client, so it runs identically in a test.
 */

import type { LocalFirstSnapshot } from './storeContract.js';

export {
  JOURNAL_DELTA_MAGIC,
  JOURNAL_FRAME_MAGIC,
  crc32,
  encodeDeltaFrame,
  encodeJournalFrame,
} from './journalCodec.js';
export {
  decodeJournalFrames,
  isLocalFirstSnapshot,
  readJournalTail,
  scanJournal,
  scanJournalAsync,
  type JournalOpenScan,
  type JournalScan,
  type JournalTail,
} from './journalReplay.js';
export {
  DEFAULT_COMPACTION_FRAME,
  DEFAULT_JOURNAL_COMPACTION,
  mintJournalGeneration,
  shouldCompactJournal,
  snapshotFrames,
  type CompactionFrameLimits,
  type JournalCompactionPolicy,
} from './journalCompaction.js';

export const EMPTY_LOCAL_FIRST_SNAPSHOT: LocalFirstSnapshot = {
  records: [],
  events: [],
  mappings: [],
  receipts: [],
  conflicts: [],
  cursors: {},
  nextSequence: 1,
};

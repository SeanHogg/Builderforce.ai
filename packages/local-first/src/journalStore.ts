/**
 * G03: a durable local-first store whose commit is one append.
 *
 * The VSIX host used to keep every record in one JSON file, rewritten whole on
 * each transaction (`clients/vscode/src/localFirstStore.ts`). That file is a
 * store: it is rewritten by every entity write, and a write that is cut off
 * mid-file leaves a file nobody can open. This module is the replacement
 * commit boundary — the host appends one length-prefixed, checksummed frame
 * per committed transaction to a journal file and never rewrites a frame in
 * place.
 *
 * Why a frame and not a row log: the transaction already commits records AND
 * their journal events together (see `atomicWrite.ts` `commitWriteAndEnqueue`),
 * so one frame carries both sides or neither. A kill during the append leaves a
 * torn trailing frame; `decodeJournalFrames` stops at it and the last COMPLETE
 * frame is what a restart opens. That is what makes "a kill between the record
 * and its journal commits neither" true: there is no order in which one half is
 * durable and the other is not.
 *
 * I/O is injected (`JournalIo`), so this module opens no file, imports no
 * network client, and runs identically in a test. The host supplies `node:fs`.
 */

import {
  createMemoryLocalFirstStore,
  type LocalFirstSnapshot,
  type LocalFirstStore,
} from './store.js';

/** Frame header is `BFJF1` + u32 length + u32 crc32 of the body. */
export const JOURNAL_FRAME_MAGIC = 'BFJF1';
const MAGIC_BYTES = JOURNAL_FRAME_MAGIC.length;
const HEADER_BYTES = MAGIC_BYTES + 8;

export const EMPTY_LOCAL_FIRST_SNAPSHOT: LocalFirstSnapshot = {
  records: [],
  events: [],
  mappings: [],
  receipts: [],
  conflicts: [],
  cursors: {},
  nextSequence: 1,
};

/** The host's file operations. Every one of them may fail; nothing is assumed. */
export interface JournalIo {
  /** Whole journal. `undefined` when no journal file exists yet. */
  read(): Promise<Uint8Array | undefined>;
  /** Append one frame at the end. A torn append is discarded on the next open. */
  append(frame: Uint8Array): Promise<void>;
  /** Replace the whole journal atomically (compaction). */
  replace(frame: Uint8Array): Promise<void>;
  /** Current journal size, for the compaction threshold. */
  size(): Promise<number>;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Order-stable, so two exports of the same state are the same frame bytes. */
export function canonicalSnapshot(snapshot: LocalFirstSnapshot): LocalFirstSnapshot {
  const byEntity = (a: { entityType: string; id: string }, b: { entityType: string; id: string }): number =>
    a.entityType === b.entityType ? a.id.localeCompare(b.id) : a.entityType.localeCompare(b.entityType);
  return {
    records: [...snapshot.records].sort(byEntity),
    events: [...snapshot.events].sort((a, b) => a.localSequence - b.localSequence),
    mappings: [...snapshot.mappings].sort((a, b) =>
      `${a.entityType}:${a.clientEntityId}`.localeCompare(`${b.entityType}:${b.clientEntityId}`)),
    receipts: [...snapshot.receipts].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    conflicts: [...snapshot.conflicts].sort((a, b) => a.id.localeCompare(b.id)),
    cursors: Object.fromEntries(
      Object.entries(snapshot.cursors ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ),
    nextSequence: snapshot.nextSequence,
  };
}

/** One committed transaction, as bytes a host appends to its journal. */
export function encodeJournalFrame(snapshot: LocalFirstSnapshot): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(canonicalSnapshot(snapshot)));
  const frame = new Uint8Array(HEADER_BYTES + body.length);
  for (let index = 0; index < MAGIC_BYTES; index += 1) {
    frame[index] = JOURNAL_FRAME_MAGIC.charCodeAt(index);
  }
  const view = new DataView(frame.buffer);
  view.setUint32(MAGIC_BYTES, body.length, false);
  view.setUint32(MAGIC_BYTES + 4, crc32(body), false);
  frame.set(body, HEADER_BYTES);
  return frame;
}

export function isLocalFirstSnapshot(value: unknown): value is LocalFirstSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<LocalFirstSnapshot>;
  return Array.isArray(snapshot.records)
    && Array.isArray(snapshot.events)
    && Array.isArray(snapshot.mappings)
    && Array.isArray(snapshot.receipts)
    && Array.isArray(snapshot.conflicts)
    && !!snapshot.cursors
    && typeof snapshot.cursors === 'object'
    && typeof snapshot.nextSequence === 'number';
}

/**
 * Every COMPLETE frame, oldest first. Reading stops at the first frame that is
 * truncated, mis-checksummed, or not a snapshot — that is the frame a kill cut
 * short, and everything before it is committed.
 */
export function decodeJournalFrames(bytes: Uint8Array): LocalFirstSnapshot[] {
  const frames: LocalFirstSnapshot[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + HEADER_BYTES <= bytes.byteLength) {
    for (let index = 0; index < MAGIC_BYTES; index += 1) {
      if (bytes[offset + index] !== JOURNAL_FRAME_MAGIC.charCodeAt(index)) return frames;
    }
    const length = view.getUint32(offset + MAGIC_BYTES, false);
    const expected = view.getUint32(offset + MAGIC_BYTES + 4, false);
    const start = offset + HEADER_BYTES;
    const end = start + length;
    // A short read is the torn tail. Nothing after it can be trusted.
    if (end > bytes.byteLength) return frames;
    const body = bytes.subarray(start, end);
    if (crc32(body) !== expected) return frames;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
    } catch {
      return frames;
    }
    if (!isLocalFirstSnapshot(parsed)) return frames;
    frames.push(parsed);
    offset = end;
  }
  return frames;
}

export interface JournaledLocalFirstStoreOptions {
  readonly io: JournalIo;
  /** State to open from when the journal has no frame yet (one-way import). */
  readonly initial?: LocalFirstSnapshot;
  /** Compact once this many frames have accumulated. */
  readonly maxFrames?: number;
  /** Compact once the journal reaches this many bytes. */
  readonly maxBytes?: number;
  /**
   * Awaited before the first committed transaction appends. The host passes
   * the promise that makes the device id durable, so no frame can exist that
   * stamps an id a restart would not find (G04).
   */
  readonly beforeWrite?: Promise<void> | (() => Promise<void>);
}

export interface JournaledLocalFirstStore extends LocalFirstStore {
  /**
   * Open the journal. `initial` is used ONLY when no complete frame exists, so
   * a host may import a legacy file exactly once. Safe to call repeatedly.
   */
  hydrate(initial?: LocalFirstSnapshot): Promise<void>;
  /** Rewrite the journal as a single frame. */
  compact(): Promise<void>;
  /** Complete frames currently in the journal. */
  frameCount(): Promise<number>;
}

export function createJournaledLocalFirstStore(
  options: JournaledLocalFirstStoreOptions,
): JournaledLocalFirstStore {
  const maxFrames = options.maxFrames ?? 32;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const listeners = new Set<() => void>();
  let memory: LocalFirstStore = createMemoryLocalFirstStore(EMPTY_LOCAL_FIRST_SNAPSHOT);
  let state: LocalFirstSnapshot = EMPTY_LOCAL_FIRST_SNAPSHOT;
  let frames = 0;
  let tail: Promise<unknown> = Promise.resolve();
  let opened: Promise<void> | undefined;

  const reset = (next: LocalFirstSnapshot): void => {
    state = next;
    memory = createMemoryLocalFirstStore(next);
  };

  const hydrate = async (initial?: LocalFirstSnapshot): Promise<void> => {
    const bytes = await options.io.read();
    const found = bytes ? decodeJournalFrames(bytes) : [];
    if (found.length > 0) {
      reset(structuredClone(found[found.length - 1]));
      frames = found.length;
      return;
    }
    // No committed frame yet. Import `initial` as the opening state; the first
    // committed transaction publishes it as frame 1.
    reset(structuredClone(initial ?? EMPTY_LOCAL_FIRST_SNAPSHOT));
    frames = 0;
  };

  const open = (): Promise<void> => {
    opened ??= hydrate(options.initial);
    return opened;
  };

  const compactNow = async (): Promise<void> => {
    await options.io.replace(encodeJournalFrame(state));
    frames = 1;
  };

  const beforeWrite = async (): Promise<void> => {
    const gate = options.beforeWrite;
    if (!gate) return;
    await (typeof gate === 'function' ? gate() : gate);
  };

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const transact: LocalFirstStore['transact'] = (work) => {
    const run = tail.then(async () => {
      await open();
      const previous = state;
      let result: unknown;
      let next: LocalFirstSnapshot;
      try {
        result = await memory.transact(work);
        next = await memory.export();
      } catch (error) {
        // The draft was never published by `memory.transact`; nothing to undo.
        throw error;
      }
      try {
        await beforeWrite();
        await options.io.append(encodeJournalFrame(next));
      } catch (error) {
        // The frame did not land. Un-publish the draft so a later read cannot
        // observe a commit that no restart would see.
        reset(previous);
        throw error;
      }
      state = next;
      frames += 1;
      if (frames >= maxFrames || (await options.io.size()) >= maxBytes) {
        await compactNow();
      }
      notify();
      return result;
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  return {
    async read(work) {
      await open();
      return memory.read(work);
    },
    transact,
    async export() {
      await open();
      return memory.export();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate: (initial) => {
      if (opened) return opened;
      opened = hydrate(initial);
      return opened;
    },
    async compact() {
      await open();
      await compactNow();
    },
    async frameCount() {
      await open();
      return frames;
    },
  };
}
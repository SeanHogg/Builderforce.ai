/**
 * Reading a journal back: fold its frames into the state they commit.
 *
 * A journal is a BASE (one `BFJF1` snapshot, or a `BFJF2` delta chain that starts with
 * `reset:true` — what compaction writes) followed by delta frames, one per commit. Opening
 * therefore walks every frame by header and crc, then parses and folds only from the LAST
 * base onward: the megabytes before it are checksummed and never decoded.
 *
 * `scanJournal` and `scanJournalAsync` are one algorithm. It is written once as a
 * generator that yields at the points where a host may want to give the thread back;
 * the sync driver ignores the yields and the async driver `await pause()`s on each.
 */

import type { LocalFirstDelta } from './localFirstDelta.js';
import { CommittedState } from './storeState.js';
import type { LocalFirstSnapshot } from './storeContract.js';
import { isBaseFrame, walkFrames, type JournalFrameBound } from './journalCodec.js';

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

const isDelta = (value: unknown): value is LocalFirstDelta =>
  !!value && typeof value === 'object' && !Array.isArray(value);

type Parsed =
  | { readonly kind: 'snapshot'; readonly snapshot: LocalFirstSnapshot }
  | { readonly kind: 'delta'; readonly delta: LocalFirstDelta };

function parseFrame(bytes: Uint8Array, bound: JournalFrameBound): Parsed | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(bound.start, bound.end))) as unknown;
  } catch {
    return undefined;
  }
  if (bound.kind === 'snapshot') return isLocalFirstSnapshot(parsed) ? { kind: 'snapshot', snapshot: parsed } : undefined;
  return isDelta(parsed) ? { kind: 'delta', delta: parsed } : undefined;
}

/** A parsed frame applied to a state: a snapshot or a reset starts a new one. */
function applyFrame(state: CommittedState, frame: Parsed): CommittedState {
  if (frame.kind === 'snapshot') return CommittedState.from(frame.snapshot);
  state.applyDelta(frame.delta);
  return state;
}

/**
 * Every COMPLETE frame, oldest first, each materialized as the snapshot it commits. Reading
 * stops at the first frame that is truncated, mis-checksummed, or not a frame — that is the
 * frame a kill cut short, and everything before it is committed. Folding every frame is
 * O(store) each: this is the test/tooling path, hosts open with `scanJournal`.
 */
export function decodeJournalFrames(bytes: Uint8Array): LocalFirstSnapshot[] {
  const frames: LocalFirstSnapshot[] = [];
  let state = new CommittedState();
  for (const bound of walkFrames(bytes)) {
    const parsed = parseFrame(bytes, bound);
    if (!parsed) return frames;
    state = applyFrame(state, parsed);
    frames.push(state.view());
  }
  return frames;
}

/** What an open needs from a journal: the state to open, and where the committed bytes end. */
export interface JournalScan {
  /** The last committed snapshot. Undefined when no frame committed. */
  readonly latest: LocalFirstSnapshot | undefined;
  /** Committed frames. */
  readonly frames: number;
  /** Byte length of the committed prefix. Anything after it is a torn tail. */
  readonly committedBytes: number;
}

/** A scan plus where the last BASE ends, so a host can apply its compaction policy to the TAIL only. */
export interface JournalOpenScan extends JournalScan {
  /** Committed frames after the last base (commits since the journal was last compacted). */
  readonly tailFrames: number;
  /** Bytes of those frames. */
  readonly tailBytes: number;
}

interface Folded {
  state: CommittedState | undefined;
  applied: number;
  /** Index of the frame that ends the last base chain. */
  baseEnd: number;
}

function* foldFrom(bytes: Uint8Array, bounds: readonly JournalFrameBound[], from: number): Generator<void, Folded> {
  let state: CommittedState | undefined;
  let applied = 0;
  let lastBase = -1;
  let closedAt: number | undefined;
  for (let index = from; index < bounds.length; index += 1) {
    const bound = bounds[index]!;
    const parsed = parseFrame(bytes, bound);
    if (!parsed) break;
    const base = isBaseFrame(bytes, bound);
    state = applyFrame(state ?? new CommittedState(), parsed);
    applied += 1;
    const endsBase = parsed.kind === 'snapshot' || (parsed.kind === 'delta' && parsed.delta.endsBase === true);
    if (base) {
      lastBase = index;
      closedAt = endsBase ? index : undefined;
    } else if (endsBase && closedAt === undefined && lastBase >= 0) {
      closedAt = index;
    }
    yield;
  }
  return { state, applied, baseEnd: closedAt ?? lastBase };
}

function* scanSteps(bytes: Uint8Array): Generator<void, JournalOpenScan> {
  const bounds: JournalFrameBound[] = [];
  for (const bound of walkFrames(bytes)) {
    bounds.push(bound);
    yield;
  }
  if (bounds.length === 0) return { latest: undefined, frames: 0, committedBytes: 0, tailFrames: 0, tailBytes: 0 };
  let start = 0;
  for (let index = bounds.length - 1; index >= 0; index -= 1) {
    if (isBaseFrame(bytes, bounds[index]!)) { start = index; break; }
  }
  let from = start;
  let folded = yield* foldFrom(bytes, bounds, from);
  // A crc-valid frame that still fails to parse (never seen in practice): fall back to
  // folding from the very start, so the result is exactly what `decodeJournalFrames` commits.
  if (from > 0 && from + folded.applied < bounds.length) {
    from = 0;
    folded = yield* foldFrom(bytes, bounds, from);
  }
  const committed = from + folded.applied;
  if (!folded.state || folded.applied === 0) return { latest: undefined, frames: 0, committedBytes: 0, tailFrames: 0, tailBytes: 0 };
  const committedBytes = bounds[committed - 1]!.end;
  const tailFrames = Math.max(0, committed - 1 - folded.baseEnd);
  const tailBytes = folded.baseEnd >= 0 ? committedBytes - bounds[folded.baseEnd]!.end : committedBytes;
  return { latest: folded.state.view(), frames: committed, committedBytes, tailFrames, tailBytes };
}

function drive(steps: Generator<void, JournalOpenScan>): JournalOpenScan {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * Open a journal: the last committed snapshot, how many frames committed, and where the
 * committed bytes end. Only the frames from the last base onward are parsed.
 */
export function scanJournal(bytes: Uint8Array): JournalScan {
  const { latest, frames, committedBytes } = drive(scanSteps(bytes));
  return { latest, frames, committedBytes };
}

/** `scanJournal` for a host's open: gives the thread back (`pause`) between frames. */
export async function scanJournalAsync(bytes: Uint8Array, pause: () => Promise<void>): Promise<JournalOpenScan> {
  const steps = scanSteps(bytes);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await pause();
  }
}

/** What follows a position the reader already holds. */
export interface JournalTail {
  /** Complete delta frames, oldest first. */
  readonly deltas: readonly LocalFirstDelta[];
  /** Bytes the deltas span. */
  readonly consumedBytes: number;
  /** A base frame (a compaction landed on this file): the reader must reload, not apply. */
  readonly needsReload: boolean;
}

/**
 * Parse the bytes AFTER a reader's tracked offset: complete delta frames, stopping at a
 * torn tail (left for the next committer to cut) or at a base frame (`needsReload`).
 */
export function readJournalTail(bytes: Uint8Array): JournalTail {
  const deltas: LocalFirstDelta[] = [];
  let consumedBytes = 0;
  for (const bound of walkFrames(bytes)) {
    if (isBaseFrame(bytes, bound)) return { deltas, consumedBytes, needsReload: true };
    const parsed = parseFrame(bytes, bound);
    if (!parsed || parsed.kind !== 'delta') break;
    deltas.push(parsed.delta);
    consumedBytes = bound.end;
  }
  return { deltas, consumedBytes, needsReload: false };
}

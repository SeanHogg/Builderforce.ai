/**
 * The RE-VERIFICATION tracker behind the progress detector's `reverifying` signal: a turn
 * whose only reads are files the run itself already wrote AND already read back since
 * that write. The FIRST read-back after a write inspects the edit (it may have
 * half-applied, chat #70776); only a later look at the same unchanged bytes is
 * re-verification.
 *
 * Pure; the state is plain JSON and bounded, so the cloud durable loop carries it.
 */

/** Written / read-back paths remembered — enough for a real run, small enough for durable
 *  state (a Durable Object value caps at 128 KiB); beyond it the oldest are dropped. */
export const MAX_REVERIFY_PATHS = 200;

export interface ReverifyState {
  /** Paths this run has written (most recent last, at most {@link MAX_REVERIFY_PATHS}). */
  writtenPaths?: string[];
  /** Written paths already read back since their last write (bounded likewise). */
  readBackSinceWrite?: string[];
}

/** Add `path` as the most recent member, dropping the oldest past {@link MAX_REVERIFY_PATHS}. */
function addBounded(set: Set<string>, path: string): void {
  set.delete(path);
  set.add(path);
  while (set.size > MAX_REVERIFY_PATHS) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

/** A restored path list, trimmed to the newest {@link MAX_REVERIFY_PATHS}. */
function restoreBounded(paths: readonly string[] | undefined): Set<string> {
  return new Set((paths ?? []).slice(-MAX_REVERIFY_PATHS));
}

export class ReverifyTracker {
  private readonly writtenPaths: Set<string>;
  private readonly readBackSinceWrite: Set<string>;
  /** Read-only targets seen this turn, to tell an all-written re-read turn from real work. */
  private readsThisTurn = 0;
  /** Whether every read this turn was a repeat read-back of an unchanged written path. */
  private allRepeatReadBacks = true;

  constructor(state: ReverifyState = {}) {
    this.writtenPaths = restoreBounded(state.writtenPaths);
    this.readBackSinceWrite = restoreBounded(state.readBackSinceWrite);
  }

  /** A call that may have changed ANY file wrote: no read-back is a look at unchanged bytes. */
  wroteAnything(): void {
    this.readBackSinceWrite.clear();
  }

  /** `path` was written: its next read-back inspects the edit again. */
  wrote(path: string): void {
    addBounded(this.writtenPaths, path);
    this.readBackSinceWrite.delete(path);
  }

  /** A successful read-only call visited `target`. */
  read(target: string): void {
    this.readsThisTurn += 1;
    if (this.writtenPaths.has(target)) {
      if (!this.readBackSinceWrite.has(target)) this.allRepeatReadBacks = false;
      addBounded(this.readBackSinceWrite, target);
    } else {
      this.allRepeatReadBacks = false;
    }
  }

  /** The turn ended: how many reads it made when ALL were repeat read-backs (else 0). Starts the next turn. */
  endTurn(): number {
    const count = this.readsThisTurn > 0 && this.allRepeatReadBacks ? this.readsThisTurn : 0;
    this.readsThisTurn = 0;
    this.allRepeatReadBacks = true;
    return count;
  }

  snapshot(): ReverifyState {
    return {
      ...(this.writtenPaths.size ? { writtenPaths: [...this.writtenPaths] } : {}),
      ...(this.readBackSinceWrite.size ? { readBackSinceWrite: [...this.readBackSinceWrite] } : {}),
    };
  }
}

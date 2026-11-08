/**
 * The size admission of a collaboration room: refuse a document update that would push the merged
 * Yjs state past a hard ceiling.
 *
 * A `Y.Doc` cannot un-apply an update, so the check runs BEFORE the update is applied, against an
 * upper bound: the size last persisted (or loaded) plus the bytes of data frames accepted since.
 * The bound is re-based on every persist. It over-counts a little (deletes shrink the real state),
 * which is the safe direction for a ceiling.
 */

/** The hard ceiling on a room's merged Yjs state. */
export const MAX_STATE_BYTES = 8 * 1024 * 1024;
/** Close code for a socket whose update would push the room past the ceiling ("message too big"). */
export const CLOSE_TOO_LARGE = 1009;

export class StateAdmission {
  private stateBytes = 0;
  private pendingBytes = 0;

  constructor(private readonly maxBytes = MAX_STATE_BYTES) {}

  /** The state is now `bytes` long on disk (after a load or a persist): re-base the bound. */
  settle(bytes: number): void {
    this.stateBytes = bytes;
    this.pendingBytes = 0;
  }

  /** May a data frame of `frameBytes` be applied? When yes it is counted against the bound. */
  admit(frameBytes: number): boolean {
    if (this.stateBytes + this.pendingBytes + frameBytes > this.maxBytes) return false;
    this.pendingBytes += frameBytes;
    return true;
  }

  /** Numbers for a log line when a frame is refused. */
  details(frameBytes: number): { stateBytes: number; pendingBytes: number; updateBytes: number } {
    return { stateBytes: this.stateBytes, pendingBytes: this.pendingBytes, updateBytes: frameBytes };
  }
}

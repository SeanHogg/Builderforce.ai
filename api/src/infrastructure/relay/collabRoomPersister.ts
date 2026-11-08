import * as Y from 'yjs';
import type { ThrottledReporter } from '../../application/observability/throttledReporter';
import type { StateAdmission } from './collabRoomAdmission';
import { EMPTY_SHAPE, loadRoomState, saveRoomState, type StoredShape } from './collabRoomStorage';

/**
 * Loads a room's `Y.Doc` from storage and writes it back, debounced.
 *
 * Every keystroke is an update, and persisting each one would put a storage write on the critical
 * path of typing. Persisting NEVER would mean a room that evicts loses whatever arrived since the
 * last natural pause. A short debounce is the whole trade: at most `debounceMs` of typing is at risk,
 * and only if the object is evicted inside the window, and only if every participant also
 * disconnected — a connected peer still holds the state and re-syncs it.
 */
export class RoomPersister {
  /** What storage currently holds, so a save can delete what it supersedes. */
  shape: StoredShape = EMPTY_SHAPE;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly doc: Y.Doc,
    private readonly storage: DurableObjectStorage | undefined,
    private readonly admission: StateAdmission,
    private readonly report: ThrottledReporter,
    private readonly debounceMs: number,
  ) {}

  /** Apply the stored state to the doc. Run inside `blockConcurrencyWhile`, before any message is handled. */
  async load(): Promise<void> {
    const { bytes, shape } = await loadRoomState(this.storage);
    this.shape = shape;
    if (!bytes) return;
    Y.applyUpdate(this.doc, bytes);
    this.admission.settle(bytes.byteLength);
  }

  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist();
    }, this.debounceMs);
  }

  async persist(): Promise<void> {
    let stateBytes = 0;
    try {
      const update = Y.encodeStateAsUpdate(this.doc);
      stateBytes = update.byteLength;
      this.shape = await saveRoomState(this.storage, update, this.shape);
      this.admission.settle(stateBytes);
    } catch (error) {
      // A failed write must not take the room down: the document is still correct in
      // memory and in every connected client, and the next update reschedules. It is NOT
      // quiet, though: the report carries the state size that tells a too-big document
      // apart from a transient error, and is throttled because it repeats on every save.
      this.report('persist', error, {
        operation: 'persist',
        level: 'error',
        context: { logMessage: '[CollaborationRoomDO] failed to persist the document', details: { stateBytes } },
      });
    }
  }
}
